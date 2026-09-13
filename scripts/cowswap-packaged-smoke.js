const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const MAX_ATTEMPTS_PER_RUN = Number(process.env.COWSWAP_SMOKE_ATTEMPTS || '3');

const PUBLIC_EOA = '0x28c6c06298d514db089934071355e5743bf21d60';
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const SETTLEMENT = '0x9008d19f58aabd9ed0d60971565aa8510560ab41';
const VAULT_RELAYER = '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110';
const ETH_FLOW = '0xba3cb449bd2b4adddbc894d8697f5170800eadec';
const KNOWN_FULFILLED_ORDER =
  '0xf9a2f45d8334f0767e72392b51f03c1a1a7864929922786cefb51931c18a13d4508e686a95d155c78eb60fc786637d8bc30f0c076a6f1606';
const KNOWN_ORDER_OWNER = '0x508e686a95d155c78eb60fc786637d8bc30f0c07';
const AMOUNT = '1000000000000000';

const normalRequest = {
  chainServerId: 'eth',
  fromToken: { address: WETH, decimals: 18, symbol: 'WETH' },
  toToken: { address: USDC, decimals: 6, symbol: 'USDC' },
  amount: AMOUNT,
  userAddress: PUBLIC_EOA,
  slippage: '0.5',
};
const decimalPriceRequest = {
  ...normalRequest,
  fromToken: { address: USDC, decimals: 6, symbol: 'USDC' },
  toToken: { address: WETH, decimals: 18, symbol: 'WETH' },
  amount: '1000000000',
};
const nativeRequest = {
  ...normalRequest,
  fromToken: { address: NATIVE, decimals: 18, symbol: 'ETH' },
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const terminateProcessGroup = (child, signal) => {
  try {
    if (process.platform === 'win32' || !child.pid) child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
};

const parseArgs = () => {
  const args = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const [key, ...rest] = arg.replace(/^--/, '').split('=');
      return [key, rest.join('=') || 'true'];
    })
  );
  return {
    chromium: args.chromium || process.env.CHROMIUM || 'chromium',
    extensionDir: path.resolve(args['extension-dir'] || 'dist'),
    runs: Number(args.runs || 2),
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
    this.eventListeners = new Set();
    socket.on('message', (buffer) => {
      const message = JSON.parse(String(buffer));
      if (message.method && !message.id) {
        for (const listener of this.eventListeners) listener(message);
        return;
      }
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

  onEvent(listener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
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

const evaluate = async (client, expression, timeoutMs = 180_000) => {
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

const smokeExpression = () => `
(async () => {
  const callController = (method, params, expectError = false) =>
    new Promise((resolve, reject) => {
      const ident = 'cowswap-smoke-' + method + '-' + Date.now() + '-' + Math.random();
      const port = chrome.runtime.connect(undefined, { name: 'tab' });
      const timer = setTimeout(() => {
        port.disconnect();
        reject(new Error(method + ' timed out'));
      }, 120000);
      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
          clearTimeout(timer);
          reject(new Error(chrome.runtime.lastError.message));
        }
      });
      port.onMessage.addListener((message) => {
        if (message?._type_ !== 'ETH_WALLET_response' || message?.data?.ident !== ident) return;
        clearTimeout(timer);
        port.disconnect();
        if (message.data.err) {
          if (expectError) resolve({ expectedError: message.data.err.message || String(message.data.err) });
          else
            reject(
              new Error(
                method + ': ' + (message.data.err.message || String(message.data.err))
              )
            );
        } else if (expectError) {
          reject(new Error(method + ' unexpectedly succeeded'));
        } else {
          resolve(message.data.res);
        }
      });
      port.postMessage({
        _type_: 'ETH_WALLET_request',
        data: {
          ident,
          data: { type: 'controller', method, params },
        },
      });
    });

  const readyDeadline = Date.now() + 60000;
  while (Date.now() < readyDeadline) {
    try {
      if (await chrome.runtime.sendMessage({ type: 'getBackgroundReady' })) break;
    } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  await callController('setCustomRPC', [
    'ETH',
    'https://eth.drpc.org',
    ['https://1rpc.io/eth'],
  ]);
  await callController('setRPCEnable', ['ETH', true]);

  const token = await callController('getCowSwapTokenMetadata', [{
    chainServerId: 'eth', tokenAddress: '${WETH}', ownerAddress: '${PUBLIC_EOA}'
  }]);
  const normalQuote = await callController('getCowSwapQuote', [${JSON.stringify(
    normalRequest
  )}]);
  const decimalPriceQuote = await callController('getCowSwapQuote', [${JSON.stringify(
    decimalPriceRequest
  )}]);
  const badSignature = '0x' + '00'.repeat(65);
  const signatureGate = await callController('submitCowSwapOrder', [{
    quoteHandle: normalQuote.quoteHandle,
    chainServerId: 'eth',
    userAddress: '${PUBLIC_EOA}',
    signature: badSignature,
  }], true);
  const nativeQuote = await callController('getCowSwapQuote', [${JSON.stringify(
    nativeRequest
  )}]);
  const nativePrepared = await callController('consumeCowSwapNativeOrder', [{
    quoteHandle: nativeQuote.quoteHandle,
    chainServerId: 'eth',
    userAddress: '${PUBLIC_EOA}',
  }]);
  const knownStatus = await callController('getCowSwapOrderStatus', [{
    chainServerId: 'eth',
    orderUid: '${KNOWN_FULFILLED_ORDER}',
    ownerAddress: '${KNOWN_ORDER_OWNER}',
  }]);
  const cancellationGate = await callController('prepareCowSwapCancellation', [{
    chainServerId: 'eth',
    orderUid: '${KNOWN_FULFILLED_ORDER}',
    ownerAddress: '${KNOWN_ORDER_OWNER}',
  }], true);
  const tabs = await chrome.tabs.query({});
  return {
    token,
    normalQuote: {
      provider: normalQuote.provider,
      chainId: normalQuote.chainId,
      amountIn: normalQuote.amountIn,
      amountOut: normalQuote.amountOut,
      minimumAmountOut: normalQuote.minimumAmountOut,
      approvalSpender: normalQuote.approvalSpender,
      nativeSell: normalQuote.nativeSell,
      expectedOrderUid: normalQuote.expectedOrderUid,
      signingDomain: normalQuote.signingPayload?.domain,
      signingDomainTypeCount:
        normalQuote.signingPayload?.types?.EIP712Domain?.length,
    },
    decimalPriceQuote: {
      provider: decimalPriceQuote.provider,
      chainId: decimalPriceQuote.chainId,
      amountIn: decimalPriceQuote.amountIn,
      amountOut: decimalPriceQuote.amountOut,
      minimumAmountOut: decimalPriceQuote.minimumAmountOut,
      approvalSpender: decimalPriceQuote.approvalSpender,
      nativeSell: decimalPriceQuote.nativeSell,
      expectedOrderUid: decimalPriceQuote.expectedOrderUid,
    },
    signatureGate,
    nativeQuote: {
      provider: nativeQuote.provider,
      amountIn: nativeQuote.amountIn,
      amountOut: nativeQuote.amountOut,
      minimumAmountOut: nativeQuote.minimumAmountOut,
      nativeSell: nativeQuote.nativeSell,
      expectedOrderUid: nativeQuote.expectedOrderUid,
    },
    nativePrepared,
    knownStatus,
    cancellationGate,
    cowTabs: tabs.map((tab) => tab.url || '').filter((url) =>
      url.startsWith('https://api.cow.fi/') || url.startsWith('https://swap.cow.fi/')
    ),
  };
})()
`;

const assertUint = (value, label, allowZero = false) => {
  if (!/^\d+$/.test(String(value)) || (!allowZero && BigInt(value) <= 0n)) {
    throw new Error(`${label} is not a valid unsigned amount`);
  }
};

const assertSmokeResult = (result) => {
  if (!result?.token || result.token.address !== WETH) {
    throw new Error('Packaged controller returned invalid WETH metadata');
  }
  if (
    result.token.decimals !== 18 ||
    BigInt(result.token.balance) < BigInt(AMOUNT)
  ) {
    throw new Error(
      'Packaged controller returned invalid WETH balance or decimals'
    );
  }
  const quote = result.normalQuote;
  if (
    quote.provider !== 'CoW Swap' ||
    quote.chainId !== 1 ||
    quote.amountIn !== AMOUNT ||
    quote.approvalSpender !== VAULT_RELAYER ||
    quote.nativeSell !== false
  ) {
    throw new Error(
      'Packaged controller returned invalid EIP-712 CoW quote context'
    );
  }
  assertUint(quote.amountOut, 'normal quoted output');
  assertUint(quote.minimumAmountOut, 'normal minimum output');
  if (BigInt(quote.minimumAmountOut) > BigInt(quote.amountOut)) {
    throw new Error('Normal CoW minimum exceeds quoted output');
  }
  if (
    quote.signingDomain?.name !== 'Gnosis Protocol' ||
    quote.signingDomain?.version !== 'v2' ||
    quote.signingDomain?.chainId !== 1 ||
    quote.signingDomain?.verifyingContract !== SETTLEMENT ||
    quote.signingDomainTypeCount !== 4
  ) {
    throw new Error(
      'Packaged controller returned an invalid CoW signing domain'
    );
  }
  if (!quote.expectedOrderUid.includes(PUBLIC_EOA.slice(2))) {
    throw new Error('Normal CoW UID does not encode the expected owner');
  }
  if (!/signature/i.test(result.signatureGate?.expectedError || '')) {
    throw new Error(
      'Packaged controller did not reject the invalid order signature'
    );
  }

  const decimalPriceQuote = result.decimalPriceQuote;
  if (
    decimalPriceQuote.provider !== 'CoW Swap' ||
    decimalPriceQuote.chainId !== 1 ||
    decimalPriceQuote.amountIn !== decimalPriceRequest.amount ||
    decimalPriceQuote.approvalSpender !== VAULT_RELAYER ||
    decimalPriceQuote.nativeSell !== false
  ) {
    throw new Error(
      'Packaged controller returned invalid decimal-price CoW quote context'
    );
  }
  assertUint(decimalPriceQuote.amountOut, 'decimal-price quoted output');
  assertUint(
    decimalPriceQuote.minimumAmountOut,
    'decimal-price minimum output'
  );
  if (
    BigInt(decimalPriceQuote.minimumAmountOut) >
    BigInt(decimalPriceQuote.amountOut)
  ) {
    throw new Error('Decimal-price CoW minimum exceeds quoted output');
  }
  if (!decimalPriceQuote.expectedOrderUid.includes(PUBLIC_EOA.slice(2))) {
    throw new Error('Decimal-price CoW UID does not encode the expected owner');
  }

  const native = result.nativeQuote;
  if (native.provider !== 'CoW Swap' || native.nativeSell !== true) {
    throw new Error(
      'Packaged controller returned invalid native CoW quote context'
    );
  }
  assertUint(native.amountOut, 'native quoted output');
  assertUint(native.minimumAmountOut, 'native minimum output');
  if (!native.expectedOrderUid.includes(ETH_FLOW.slice(2))) {
    throw new Error(
      'Native CoW UID does not encode the official EthFlow owner'
    );
  }
  const transaction = result.nativePrepared?.transaction;
  if (
    result.nativePrepared?.orderUid !== native.expectedOrderUid ||
    transaction?.from !== PUBLIC_EOA ||
    transaction?.to !== ETH_FLOW ||
    transaction?.value !== '0x38d7ea4c68000' ||
    !/^0x[0-9a-f]+$/.test(transaction?.gas || '') ||
    !/^0x[0-9a-f]{10,}$/.test(transaction?.data || '')
  ) {
    throw new Error(
      'Packaged controller returned an invalid EthFlow transaction'
    );
  }

  if (
    result.knownStatus?.orderUid !== KNOWN_FULFILLED_ORDER ||
    result.knownStatus?.status !== 'fulfilled' ||
    result.knownStatus?.owner !== KNOWN_ORDER_OWNER ||
    result.knownStatus?.terminal !== true
  ) {
    throw new Error(
      'Packaged controller failed to validate the known fulfilled order'
    );
  }
  if (
    !/cannot be cancelled/i.test(result.cancellationGate?.expectedError || '')
  ) {
    throw new Error(
      'Packaged controller did not block cancellation of a fulfilled order'
    );
  }
  if (result.cowTabs?.length) {
    throw new Error(
      `CoW transport unexpectedly opened tabs: ${result.cowTabs.join(', ')}`
    );
  }
};

const runOnce = async (
  { chromium, extensionDir, headless, keepProfiles },
  runNumber
) => {
  const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), `hippo-cowswap-smoke-${runNumber}-`)
  );
  const port = await getFreePort();
  const stderr = [];
  const chromiumArgs = [
    '--no-sandbox',
    '--disable-field-trial-config',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-back-forward-cache',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-features=GlobalMediaControls,HttpsUpgrades,MediaRouter,OptimizationHints,PaintHolding,RenderDocument,Translate',
    '--allow-pre-commit-input',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--metrics-recording-only',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-service-autorun',
    '--password-store=basic',
    '--use-mock-keychain',
    '--disable-search-engine-choice-screen',
    '--disable-sync',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    'about:blank',
  ];
  if (headless) chromiumArgs.unshift('--headless=new');
  const browser = childProcess.spawn(chromium, chromiumArgs, {
    detached: true,
    env: { ...process.env, DISPLAY: process.env.DISPLAY || ':99' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  browser.stderr.on('data', (chunk) => {
    stderr.push(String(chunk));
    if (stderr.join('').length > 50_000) stderr.shift();
  });

  let client;
  let workerClient = null;
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

    // Capture the RAW order-book /quote responses at the service-worker
    // boundary via CDP so the fractional sellTokenPrice requirement is proven
    // end-to-end in the packaged runtime (an integer-only parser could not
    // survive a real decimal response), not just in unit fixtures.
    const rawQuotes = [];
    if (worker?.webSocketDebuggerUrl) {
      try {
        workerClient = await CdpClient.connect(worker.webSocketDebuggerUrl);
        const quoteRequests = new Map();
        workerClient.onEvent(async (message) => {
          if (message.method === 'Network.responseReceived') {
            const { requestId, response } = message.params || {};
            if (String(response?.url || '').includes('/api/v1/quote')) {
              quoteRequests.set(requestId, response.url);
            }
          } else if (message.method === 'Network.loadingFinished') {
            const requestId = message.params?.requestId;
            if (!quoteRequests.has(requestId)) return;
            try {
              const body = await workerClient.send('Network.getResponseBody', {
                requestId,
              });
              const text = body?.base64Encoded
                ? Buffer.from(body.body, 'base64').toString('utf8')
                : body?.body;
              rawQuotes.push(JSON.parse(text));
            } catch (_) {
              /* body expired; the remaining captures still assert */
            }
          }
        });
        await workerClient.send('Network.enable');
      } catch (_) {
        workerClient = null;
      }
    }
    const extensionPage = `chrome-extension://${extensionId}/index.html#/dex-swap`;
    await client.send('Page.navigate', { url: extensionPage });
    await waitFor(async () => {
      const state = await evaluate(
        client,
        '[location.href, document.readyState]',
        5_000
      );
      return state?.[0]?.startsWith(extensionPage) && state?.[1] === 'complete';
    }, 'extension page load');
    const result = await evaluate(client, smokeExpression());

    // The raw capture is mandatory: a smoke run that could not observe the
    // fractional sellTokenPrice end-to-end does not satisfy the release gate.
    if (!workerClient) {
      throw new Error(
        'Service-worker CDP target unavailable; cannot verify raw fractional sellTokenPrice'
      );
    }
    let usdcSellRawPrice = null;
    {
      const decimalQuote = await waitFor(
        async () =>
          rawQuotes
            .map((entry) => entry?.quote)
            .find(
              (quote) =>
                String(quote?.sellToken || '').toLowerCase() === USDC
            ) || null,
        'raw USDC-sell /quote response capture',
        15_000
      );
      const price = String(decimalQuote.sellTokenPrice ?? '');
      // The packaged service already parsed and accepted this exact payload;
      // now prove the raw field itself carried a nonzero fractional part.
      if (!/^\d+\.\d*[1-9]\d*$/.test(price)) {
        throw new Error(
          'Raw CoW sellTokenPrice for the 6-decimal USDC sell was not a fractional decimal string: ' +
            JSON.stringify(price)
        );
      }
      usdcSellRawPrice = { hasFraction: true, decimals: price.split('.')[1].length };
    }

    assertSmokeResult(result);
    return {
      run: runNumber,
      profile,
      extensionId,
      rawUsdcSellTokenPrice: usdcSellRawPrice,
      normalOrderUid: result.normalQuote.expectedOrderUid,
      decimalPriceOrderUid: result.decimalPriceQuote.expectedOrderUid,
      nativeOrderUid: result.nativeQuote.expectedOrderUid,
      nativeTransactionTarget: result.nativePrepared.transaction.to,
      knownOrderStatus: result.knownStatus.status,
      openedCowTabs: result.cowTabs,
    };
  } catch (error) {
    const logs = stderr.join('').slice(-12_000);
    throw new Error(`${error.message}\nChromium stderr:\n${logs}`);
  } finally {
    if (workerClient) workerClient.close();
    if (client) client.close();
    terminateProcessGroup(browser, 'SIGTERM');
    await Promise.race([
      new Promise((resolve) => browser.once('exit', resolve)),
      delay(3_000),
    ]);
    terminateProcessGroup(browser, 'SIGKILL');
    await delay(500);
    if (!keepProfiles) {
      fs.rmSync(profile, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 250,
      });
    }
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
  if (
    !Number.isInteger(MAX_ATTEMPTS_PER_RUN) ||
    MAX_ATTEMPTS_PER_RUN < 1 ||
    MAX_ATTEMPTS_PER_RUN > 5
  ) {
    throw new Error(
      'COWSWAP_SMOKE_ATTEMPTS must be an integer from 1 through 5'
    );
  }
  const manifest = path.join(options.extensionDir, 'manifest.json');
  if (!fs.existsSync(manifest)) {
    throw new Error(`Packaged extension manifest not found: ${manifest}`);
  }
  const results = [];
  for (let run = 1; run <= options.runs; run += 1) {
    let lastError;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_RUN; attempt += 1) {
      try {
        const result = await runOnce(options, `${run}-attempt-${attempt}`);
        results.push({ ...result, run, attempt });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_ATTEMPTS_PER_RUN) await delay(2_000);
      }
    }
    if (lastError) throw lastError;
  }
  console.log(JSON.stringify({ ok: true, runs: results }, null, 2));
};

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
