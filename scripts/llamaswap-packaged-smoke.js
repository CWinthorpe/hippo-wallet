const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const EXPECTED_PROVIDERS = ['1inch', 'KyberSwap', 'ParaSwap', 'Matcha/0x v2'];
const DEFAULT_REQUEST = {
  chainServerId: 'eth',
  fromToken: {
    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    decimals: 18,
    symbol: 'ETH',
  },
  toToken: {
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    decimals: 6,
    symbol: 'USDC',
  },
  amount: '1000000000000000',
  userAddress: '0x1000000000000000000000000000000000000000',
  slippage: '0.5',
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const parseArgs = () => {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, '').split('=');
      return [key, rest.join('=') || 'true'];
    })
  );
  return {
    chromium: args.chromium || process.env.CHROMIUM || 'chromium',
    extensionDir: path.resolve(args['extension-dir'] || 'dist/chrome'),
    runs: Number(args.runs || 1),
    headless: args.headless === 'true',
    keepProfiles: args['keep-profiles'] === 'true',
  };
};

const getFreePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });

const fetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
};

const waitFor = async (operation, label, timeoutMs = 45_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`
  );
};

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.on('message', (buffer) => {
      const message = JSON.parse(String(buffer));
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    socket.on('close', () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error('CDP socket closed'));
      }
      this.pending.clear();
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { origin: 'http://127.0.0.1' });
      socket.once('open', () => resolve(new CdpClient(socket)));
      socket.once('error', reject);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

const unpackedExtensionId = (extensionDir) => {
  const digest = crypto
    .createHash('sha256')
    .update(fs.realpathSync(extensionDir))
    .digest();
  let id = '';
  for (const byte of digest.subarray(0, 16)) {
    id += String.fromCharCode(97 + (byte >> 4));
    id += String.fromCharCode(97 + (byte & 15));
  }
  return id;
};

const evaluate = async (client, expression, timeoutMs = 120_000) => {
  const result = await Promise.race([
    client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('Runtime.evaluate timed out')),
        timeoutMs
      )
    ),
  ]);
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        'Runtime.evaluate failed'
    );
  }
  return result.result?.value;
};

const smokeExpression = (request) => `
(async () => {
  const readyDeadline = Date.now() + 60000;
  let backgroundReady = false;
  while (Date.now() < readyDeadline) {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'getBackgroundReady' });
      if (response) {
        backgroundReady = true;
        break;
      }
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!backgroundReady) throw new Error('background did not become ready');

  const request = ${JSON.stringify(request)};
  const quotes = await new Promise((resolve, reject) => {
    const ident = 'llamaswap-smoke-' + Date.now() + '-' + Math.random();
    const port = chrome.runtime.connect(undefined, { name: 'tab' });
    const timer = setTimeout(() => {
      port.disconnect();
      reject(new Error('wallet controller request timed out'));
    }, 90000);
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) {
        clearTimeout(timer);
        reject(new Error(chrome.runtime.lastError.message));
      }
    });
    port.onMessage.addListener((message) => {
      if (
        message?._type_ !== 'ETH_WALLET_response' ||
        message?.data?.ident !== ident
      ) return;
      clearTimeout(timer);
      port.disconnect();
      if (message.data.err) reject(new Error(message.data.err.message));
      else resolve(message.data.res);
    });
    port.postMessage({
      _type_: 'ETH_WALLET_request',
      data: {
        ident,
        data: {
          type: 'controller',
          method: 'getLlamaSwapQuotes',
          params: [request],
        },
      },
    });
  });

  const tabs = await chrome.tabs.query({});
  return {
    quotes: quotes.map((quote) => ({
      provider: quote.provider,
      quoteSource: quote.quoteSource,
      chainServerId: quote.chainServerId,
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      minimumAmountOut: quote.minimumAmountOut,
      approvalSpender: quote.approvalSpender,
      transactionTarget: quote.transaction?.to,
      calldataBytes: Math.max(0, ((quote.transaction?.data || '').length - 2) / 2),
      providersCompared: quote.providersCompared,
      availableProviders: quote.availableProviders,
    })),
    remainingTransportTabs: tabs
      .map((tab) => tab.url || '')
      .filter((url) => url.startsWith('https://swap.defillama.com/')),
  };
})()
`;

const assertSmokeResult = (result) => {
  if (!result || !Array.isArray(result.quotes)) {
    throw new Error('Packaged controller returned no quote array');
  }
  const providers = result.quotes.map((quote) => quote.provider).sort();
  const expected = [...EXPECTED_PROVIDERS].sort();
  if (JSON.stringify(providers) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected providers ${expected.join(', ')}, got ${
        providers.join(', ') || 'none'
      }`
    );
  }
  for (const quote of result.quotes) {
    if (quote.quoteSource !== 'LlamaSwap frontend API') {
      throw new Error(`${quote.provider} returned the wrong quote source`);
    }
    if (quote.chainServerId !== DEFAULT_REQUEST.chainServerId) {
      throw new Error(`${quote.provider} returned the wrong chain`);
    }
    if (!/^\\d+$/.test(quote.amountOut) || BigInt(quote.amountOut) <= 0n) {
      throw new Error(`${quote.provider} returned an invalid output amount`);
    }
    if (!/^0x[0-9a-f]{40}$/.test(quote.approvalSpender)) {
      throw new Error(`${quote.provider} returned an invalid approval spender`);
    }
    if (!/^0x[0-9a-f]{40}$/.test(quote.transactionTarget)) {
      throw new Error(
        `${quote.provider} returned an invalid transaction target`
      );
    }
    if (!Number.isInteger(quote.calldataBytes) || quote.calldataBytes <= 4) {
      throw new Error(`${quote.provider} returned invalid calldata`);
    }
    if (
      JSON.stringify(quote.providersCompared) !==
      JSON.stringify(EXPECTED_PROVIDERS)
    ) {
      throw new Error(
        `${quote.provider} did not compare every ordinary provider`
      );
    }
  }
  if (result.remainingTransportTabs.length) {
    throw new Error(
      `Temporary transport tab leaked: ${result.remainingTransportTabs.join(
        ', '
      )}`
    );
  }
};

const runOnce = async (
  { chromium, extensionDir, headless, keepProfiles },
  runNumber
) => {
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), `hippo-llamaswap-smoke-${runNumber}-`)
  );
  const port = await getFreePort();
  const stderr = [];
  const chromiumArgs = [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    'about:blank',
  ];
  if (headless) chromiumArgs.unshift('--headless=new');
  const browser = childProcess.spawn(chromium, chromiumArgs, {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  browser.stderr.on('data', (chunk) => {
    stderr.push(String(chunk));
    if (stderr.join('').length > 50_000) stderr.shift();
  });

  let client;
  try {
    await waitFor(
      () => fetchJson(`http://127.0.0.1:${port}/json/version`),
      'Chromium DevTools endpoint'
    );
    const targets = await waitFor(async () => {
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      return list.some((target) => target.type === 'service_worker')
        ? list
        : null;
    }, 'extension service worker');
    const worker = targets.find(
      (target) =>
        target.type === 'service_worker' &&
        target.url.startsWith('chrome-extension://')
    );
    const extensionId = worker
      ? new URL(worker.url).hostname
      : unpackedExtensionId(extensionDir);
    const page = targets.find((target) => target.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('No Chromium page target');
    client = await CdpClient.connect(page.webSocketDebuggerUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    const extensionPage = `chrome-extension://${extensionId}/index.html#/swap`;
    await client.send('Page.navigate', { url: extensionPage });
    await waitFor(async () => {
      const state = await evaluate(
        client,
        '[location.href, document.readyState]',
        5_000
      );
      return state?.[0]?.startsWith(extensionPage) && state?.[1] === 'complete';
    }, 'extension page load');
    const result = await evaluate(client, smokeExpression(DEFAULT_REQUEST));
    assertSmokeResult(result);
    return {
      run: runNumber,
      profile,
      extensionId,
      providers: result.quotes.map((quote) => quote.provider),
      quotes: result.quotes,
      remainingTransportTabs: result.remainingTransportTabs,
    };
  } catch (error) {
    const logs = stderr.join('').slice(-12_000);
    throw new Error(`${error.message}\nChromium stderr:\n${logs}`);
  } finally {
    if (client) client.close();
    browser.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => browser.once('exit', resolve)),
      delay(3_000),
    ]);
    if (browser.exitCode === null && browser.signalCode === null) {
      browser.kill('SIGKILL');
    }
    if (!keepProfiles) fs.rmSync(profile, { recursive: true, force: true });
  }
};

const main = async () => {
  const options = parseArgs();
  if (
    !Number.isInteger(options.runs) ||
    options.runs < 1 ||
    options.runs > 10
  ) {
    throw new Error('--runs must be an integer from 1 through 10');
  }
  const manifest = path.join(options.extensionDir, 'manifest.json');
  if (!fs.existsSync(manifest)) {
    throw new Error(`Packaged extension manifest not found: ${manifest}`);
  }
  const results = [];
  for (let run = 1; run <= options.runs; run += 1) {
    results.push(await runOnce(options, run));
  }
  console.log(JSON.stringify({ ok: true, runs: results }, null, 2));
};

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
