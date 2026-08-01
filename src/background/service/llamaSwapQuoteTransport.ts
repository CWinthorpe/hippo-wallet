export const LLAMASWAP_QUOTE_ORIGIN = 'https://swap-api.defillama.com';
export const LLAMASWAP_QUOTE_PAGE = `${LLAMASWAP_QUOTE_ORIGIN}/`;

const QUOTE_PAGE_LOAD_TIMEOUT_MS = 20_000;
const QUOTE_REQUEST_TIMEOUT_MS = 20_000;

export interface LlamaSwapQuoteTransportRequest {
  protocol: string;
  url: string;
  body: unknown;
}

export interface LlamaSwapQuoteTransportResult {
  protocol: string;
  origin: string;
  text?: string;
  error?: string;
}

export type LlamaSwapQuoteTransport = (
  requests: LlamaSwapQuoteTransportRequest[]
) => Promise<LlamaSwapQuoteTransportResult[]>;

type ChromeQuoteApi = Pick<typeof chrome, 'tabs' | 'scripting'>;

/**
 * Runs in Chrome's isolated world inside a temporary same-origin API tab.
 * Keep this function self-contained: chrome.scripting serializes it.
 */
export function requestLlamaSwapQuotesInPage(
  requests: LlamaSwapQuoteTransportRequest[],
  expectedOrigin: string,
  maxResponseBytes: number,
  requestTimeoutMs: number
): Promise<LlamaSwapQuoteTransportResult[]> {
  const readWithLimit = (response: Response): Promise<string> => {
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
      return Promise.reject(new Error('quote response is too large'));
    }
    if (!response.body) {
      return response.text().then((text) => {
        if (text.length > maxResponseBytes) {
          throw new Error('quote response is too large');
        }
        return text;
      });
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    const pump = (): Promise<string> =>
      reader.read().then(({ done, value }) => {
        if (done) {
          const joined = new Uint8Array(received);
          let offset = 0;
          chunks.forEach((chunk) => {
            joined.set(chunk, offset);
            offset += chunk.byteLength;
          });
          return new TextDecoder().decode(joined);
        }
        if (value) {
          received += value.byteLength;
          if (received > maxResponseBytes) {
            void reader.cancel();
            throw new Error('quote response is too large');
          }
          chunks.push(value);
        }
        return pump();
      });
    return pump();
  };

  if (location.origin !== expectedOrigin) {
    return Promise.resolve(
      requests.map((request) => ({
        protocol: request.protocol,
        origin: location.origin,
        error: 'unexpected quote-page origin',
      }))
    );
  }

  try {
    history.replaceState(null, '', `${expectedOrigin}/`);
  } catch (_) {
    // Best-effort removal of Cloudflare challenge query strings from this
    // temporary tab's current history entry. Quote validation does not rely on it.
  }

  return Promise.all(
    requests.map((request) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      return fetch(request.url, {
        method: 'POST',
        mode: 'same-origin',
        credentials: 'include',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`quote request failed (${response.status})`);
          }
          return readWithLimit(response);
        })
        .then((text) => ({
          protocol: request.protocol,
          origin: location.origin,
          text,
        }))
        .catch((error) => ({
          protocol: request.protocol,
          origin: location.origin,
          error: String(error instanceof Error ? error.message : error).slice(
            0,
            200
          ),
        }))
        .finally(() => clearTimeout(timer));
    })
  );
}

const waitForQuotePage = async (
  api: ChromeQuoteApi,
  tabId: number
): Promise<chrome.tabs.Tab> => {
  const current = await api.tabs.get(tabId);
  if (current.status !== 'complete') {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        api.tabs.onUpdated.removeListener(onUpdated);
        if (error) reject(error);
        else resolve();
      };
      const timeout = setTimeout(
        () => finish(new Error('LlamaSwap quote page load timed out')),
        QUOTE_PAGE_LOAD_TIMEOUT_MS
      );
      const onUpdated = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo
      ) => {
        if (updatedTabId === tabId && changeInfo.status === 'complete')
          finish();
      };
      api.tabs.onUpdated.addListener(onUpdated);
      void api.tabs
        .get(tabId)
        .then((tab) => {
          if (tab.status === 'complete') finish();
        })
        .catch((error) =>
          finish(error instanceof Error ? error : new Error(String(error)))
        );
    });
  }
  return api.tabs.get(tabId);
};

export const fetchLlamaSwapQuotesFromOrigin = async (
  requests: LlamaSwapQuoteTransportRequest[],
  maxResponseBytes: number,
  api: ChromeQuoteApi = chrome
): Promise<LlamaSwapQuoteTransportResult[]> => {
  if (!requests.length) return [];
  requests.forEach((request) => {
    const url = new URL(request.url);
    if (
      url.origin !== LLAMASWAP_QUOTE_ORIGIN ||
      url.pathname !== '/dexAggregatorQuote' ||
      url.searchParams.get('protocol') !== request.protocol
    ) {
      throw new Error('Invalid LlamaSwap quote transport request');
    }
  });

  let tabId: number | undefined;
  try {
    const tab = await api.tabs.create({
      url: LLAMASWAP_QUOTE_PAGE,
      active: false,
    });
    if (typeof tab.id !== 'number') {
      throw new Error('Chrome did not create the LlamaSwap quote page');
    }
    tabId = tab.id;
    const loadedTab = await waitForQuotePage(api, tabId);
    let loadedOrigin = '';
    try {
      loadedOrigin = new URL(loadedTab.url || '').origin;
    } catch {
      // Rejected by the exact-origin check below.
    }
    if (loadedOrigin !== LLAMASWAP_QUOTE_ORIGIN) {
      throw new Error('LlamaSwap quote page loaded an unexpected origin');
    }

    const execution = await api.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: requestLlamaSwapQuotesInPage,
      args: [
        requests,
        LLAMASWAP_QUOTE_ORIGIN,
        maxResponseBytes,
        QUOTE_REQUEST_TIMEOUT_MS,
      ],
    });
    const results = execution[0]?.result;
    if (!Array.isArray(results) || results.length !== requests.length) {
      throw new Error('LlamaSwap quote page returned an invalid result');
    }

    return results.map((result, index) => {
      const expected = requests[index];
      if (
        !result ||
        result.protocol !== expected.protocol ||
        result.origin !== LLAMASWAP_QUOTE_ORIGIN
      ) {
        return {
          protocol: expected.protocol,
          origin: String(result?.origin || ''),
          error: 'invalid quote-page result',
        };
      }
      return {
        protocol: expected.protocol,
        origin: result.origin,
        text: typeof result.text === 'string' ? result.text : undefined,
        error:
          typeof result.error === 'string'
            ? result.error.slice(0, 200)
            : undefined,
      };
    });
  } finally {
    if (typeof tabId === 'number') {
      await api.tabs.remove(tabId).catch(() => undefined);
    }
  }
};
