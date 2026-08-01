/**
 * @jest-environment jsdom
 */

import {
  fetchLlamaSwapQuotesFromOrigin,
  LLAMASWAP_QUOTE_ORIGIN,
  requestLlamaSwapQuotesInPage,
  LlamaSwapQuoteTransportRequest,
} from '@/background/service/llamaSwapQuoteTransport';

const request: LlamaSwapQuoteTransportRequest = {
  protocol: '1inch',
  url: `${LLAMASWAP_QUOTE_ORIGIN}/dexAggregatorQuote?protocol=1inch`,
  body: { userAddress: '0x1111111111111111111111111111111111111111' },
};

const response = ({
  ok = true,
  status = 200,
  text = '{}',
  contentLength,
}: {
  ok?: boolean;
  status?: number;
  text?: string;
  contentLength?: string;
}) => ({
  ok,
  status,
  headers: {
    get: (name: string) =>
      name.toLowerCase() === 'content-length' ? contentLength || null : null,
  },
  body: null,
  text: async () => text,
});

describe('LlamaSwap same-origin quote transport', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('posts from the quote page origin with credentials and bounded output', async () => {
    const historyReplaceState = jest.spyOn(window.history, 'replaceState');
    const fetchMock = jest
      .fn()
      .mockResolvedValue(response({ text: '{"amountReturned":"1"}' }));
    (globalThis as any).fetch = fetchMock;

    const result = await requestLlamaSwapQuotesInPage(
      [request],
      window.location.origin,
      2_000_000,
      20_000
    );

    expect(result).toEqual([
      {
        protocol: '1inch',
        origin: window.location.origin,
        text: '{"amountReturned":"1"}',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      request.url,
      expect.objectContaining({
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
      })
    );
    expect(historyReplaceState).toHaveBeenCalledWith(
      null,
      '',
      `${window.location.origin}/`
    );
  });

  test('rejects the wrong page origin before network contact', async () => {
    const fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;

    await expect(
      requestLlamaSwapQuotesInPage(
        [request],
        'https://swap-api.defillama.com',
        2_000_000,
        20_000
      )
    ).resolves.toEqual([
      expect.objectContaining({
        protocol: '1inch',
        error: 'unexpected quote-page origin',
      }),
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('isolates HTTP and oversized-response failures per provider', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(response({ ok: false, status: 403 }))
      .mockResolvedValueOnce(
        response({ text: 'x'.repeat(11), contentLength: '11' })
      );
    (globalThis as any).fetch = fetchMock;
    const requests = [
      request,
      {
        ...request,
        protocol: 'KyberSwap',
        url: `${LLAMASWAP_QUOTE_ORIGIN}/dexAggregatorQuote?protocol=KyberSwap`,
      },
    ];

    const results = await requestLlamaSwapQuotesInPage(
      requests,
      window.location.origin,
      10,
      20_000
    );

    expect(results[0].error).toBe('quote request failed (403)');
    expect(results[1].error).toBe('quote response is too large');
  });

  test('opens one inactive exact-origin tab, uses the isolated world, and closes it', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 42,
      active: false,
      status: 'complete',
      url: `${LLAMASWAP_QUOTE_ORIGIN}/`,
    });
    const get = jest.fn().mockResolvedValue({
      id: 42,
      active: false,
      status: 'complete',
      url: `${LLAMASWAP_QUOTE_ORIGIN}/`,
    });
    const remove = jest.fn().mockResolvedValue(undefined);
    const executeScript = jest.fn().mockImplementation(async (options) => {
      expect(options.target).toEqual({ tabId: 42 });
      expect(options.world).toBe('ISOLATED');
      expect(options.func).toBe(requestLlamaSwapQuotesInPage);
      expect(options.args[0]).toEqual([request]);
      return [
        {
          result: [
            {
              protocol: '1inch',
              origin: LLAMASWAP_QUOTE_ORIGIN,
              text: '{}',
            },
          ],
        },
      ];
    });
    const api = {
      tabs: {
        create,
        get,
        remove,
        onUpdated: {
          addListener: jest.fn(),
          removeListener: jest.fn(),
        },
      },
      scripting: { executeScript },
    } as any;

    await expect(
      fetchLlamaSwapQuotesFromOrigin([request], 2_000_000, api)
    ).resolves.toEqual([
      {
        protocol: '1inch',
        origin: LLAMASWAP_QUOTE_ORIGIN,
        text: '{}',
        error: undefined,
      },
    ]);
    expect(create).toHaveBeenCalledWith({
      url: `${LLAMASWAP_QUOTE_ORIGIN}/`,
      active: false,
    });
    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(42);
  });

  test('rechecks tab completion after subscribing so a load event cannot race', async () => {
    const listener = {
      addListener: jest.fn(),
      removeListener: jest.fn(),
    };
    const get = jest
      .fn()
      .mockResolvedValueOnce({ id: 42, status: 'loading' })
      .mockResolvedValueOnce({
        id: 42,
        status: 'complete',
        url: `${LLAMASWAP_QUOTE_ORIGIN}/`,
      })
      .mockResolvedValueOnce({
        id: 42,
        status: 'complete',
        url: `${LLAMASWAP_QUOTE_ORIGIN}/`,
      });
    const api = {
      tabs: {
        create: jest.fn().mockResolvedValue({ id: 42 }),
        get,
        remove: jest.fn().mockResolvedValue(undefined),
        onUpdated: listener,
      },
      scripting: {
        executeScript: jest.fn().mockResolvedValue([
          {
            result: [
              {
                protocol: '1inch',
                origin: LLAMASWAP_QUOTE_ORIGIN,
                text: '{}',
              },
            ],
          },
        ]),
      },
    } as any;

    await expect(
      fetchLlamaSwapQuotesFromOrigin([request], 2_000_000, api)
    ).resolves.toHaveLength(1);
    expect(listener.addListener).toHaveBeenCalledTimes(1);
    expect(listener.removeListener).toHaveBeenCalledTimes(1);
  });

  test('closes the temporary tab when injection fails', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const api = {
      tabs: {
        create: jest.fn().mockResolvedValue({ id: 42 }),
        get: jest.fn().mockResolvedValue({
          id: 42,
          status: 'complete',
          url: `${LLAMASWAP_QUOTE_ORIGIN}/`,
        }),
        remove,
        onUpdated: {
          addListener: jest.fn(),
          removeListener: jest.fn(),
        },
      },
      scripting: {
        executeScript: jest.fn().mockRejectedValue(new Error('blocked')),
      },
    } as any;

    await expect(
      fetchLlamaSwapQuotesFromOrigin([request], 2_000_000, api)
    ).rejects.toThrow('blocked');
    expect(remove).toHaveBeenCalledWith(42);
  });
});
