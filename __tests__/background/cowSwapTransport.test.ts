import {
  COW_SWAP_DEFAULT_TIMEOUT_MS,
  COW_SWAP_MAX_RESPONSE_BYTES,
  __cowSwapTransportTestUtils,
  fetchCowSwapApi,
} from '@/background/service/cowSwapTransport';

const quoteUrl = 'https://api.cow.fi/mainnet/api/v1/quote';
const orderUid = `0x${'11'.repeat(56)}`;

const makeBody = (chunks: Uint8Array[]) => ({
  getReader: () => {
    let index = 0;
    return {
      read: jest.fn(async () => {
        if (index >= chunks.length) return { done: true, value: undefined };
        return { done: false, value: chunks[index++] };
      }),
      cancel: jest.fn(async () => undefined),
      releaseLock: jest.fn(),
    };
  },
});

const mockResponse = ({
  status = 200,
  text = '{}',
  contentType = 'application/json',
  contentLength,
}: {
  status?: number;
  text?: string;
  contentType?: string;
  contentLength?: string;
} = {}) => {
  const encoded = new TextEncoder().encode(text);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === 'content-type') return contentType;
        if (name.toLowerCase() === 'content-length')
          return contentLength || null;
        return null;
      },
    },
    body: makeBody([encoded]),
  } as any;
};

describe('CoW Swap API transport', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test('uses only fixed JSON headers with omitted credentials and no referrer', async () => {
    const fetchMock = jest.fn(async () => mockResponse({ text: '{"id":1}' }));
    global.fetch = fetchMock as any;
    const result = await fetchCowSwapApi({
      url: quoteUrl,
      method: 'POST',
      body: '{"kind":"sell"}',
    });

    expect(result).toEqual({
      status: 200,
      text: '{"id":1}',
      contentType: 'application/json',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      quoteUrl,
      expect.objectContaining({
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: '{"kind":"sell"}',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      })
    );
  });

  test.each([
    ['http://api.cow.fi/mainnet/api/v1/quote', 'POST', '{}'],
    ['https://evil.example/mainnet/api/v1/quote', 'POST', '{}'],
    [`${quoteUrl}?debug=1`, 'POST', '{}'],
    [`${quoteUrl}#fragment`, 'POST', '{}'],
    ['https://api.cow.fi/unknown/api/v1/quote', 'POST', '{}'],
    ['https://api.cow.fi/mainnet/api/v1/account/0x0/orders', 'GET', undefined],
    [`https://api.cow.fi/mainnet/api/v1/orders/${orderUid}`, 'POST', '{}'],
  ])('rejects an unapproved endpoint %s', async (url, method, body) => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as any;
    await expect(
      fetchCowSwapApi({ url, method: method as any, body })
    ).rejects.toThrow(/Invalid|Unapproved/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('allows exact order status and batch cancellation endpoints', () => {
    expect(
      __cowSwapTransportTestUtils.validateTransportRequest({
        url: `https://api.cow.fi/mainnet/api/v1/orders/${orderUid}`,
        method: 'GET',
      })
    ).toBe(`https://api.cow.fi/mainnet/api/v1/orders/${orderUid}`);
    expect(
      __cowSwapTransportTestUtils.validateTransportRequest({
        url: 'https://api.cow.fi/arbitrum_one/api/v1/orders',
        method: 'DELETE',
        body: '{}',
      })
    ).toBe('https://api.cow.fi/arbitrum_one/api/v1/orders');
  });

  test('rejects declared and streamed responses above the byte limit', async () => {
    global.fetch = jest.fn(async () =>
      mockResponse({ contentLength: String(COW_SWAP_MAX_RESPONSE_BYTES + 1) })
    ) as any;
    await expect(
      fetchCowSwapApi({ url: quoteUrl, method: 'POST', body: '{}' })
    ).rejects.toThrow('response is too large');

    const oversized = new Uint8Array(COW_SWAP_MAX_RESPONSE_BYTES + 1);
    global.fetch = jest.fn(async () => ({
      ...mockResponse(),
      body: makeBody([oversized]),
    })) as any;
    await expect(
      fetchCowSwapApi({ url: quoteUrl, method: 'POST', body: '{}' })
    ).rejects.toThrow('response is too large');
  });

  test('rejects a successful non-JSON response', async () => {
    global.fetch = jest.fn(async () =>
      mockResponse({ text: '<html>no</html>', contentType: 'text/html' })
    ) as any;
    await expect(
      fetchCowSwapApi({ url: quoteUrl, method: 'POST', body: '{}' })
    ).rejects.toThrow('non-JSON');
  });

  test('aborts at the bounded timeout', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url, init: any) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    ) as any;
    const promise = fetchCowSwapApi({
      url: quoteUrl,
      method: 'POST',
      body: '{}',
      timeoutMs: 1_000,
    });
    jest.advanceTimersByTime(1_000);
    await expect(promise).rejects.toThrow('request timed out');
  });

  test('uses the default bounded timeout when none is supplied', async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn(
      (_url, init: any) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    ) as any;
    const promise = fetchCowSwapApi({
      url: quoteUrl,
      method: 'POST',
      body: '{}',
    });
    jest.advanceTimersByTime(COW_SWAP_DEFAULT_TIMEOUT_MS);
    await expect(promise).rejects.toThrow('request timed out');
  });
});
