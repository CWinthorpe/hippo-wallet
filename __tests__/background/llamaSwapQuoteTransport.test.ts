/**
 * @jest-environment jsdom
 */

import {
  fetchLlamaSwapQuotesFromOrigin,
  LLAMASWAP_FRONTEND_ORIGIN,
  LLAMASWAP_FRONTEND_PATH,
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

describe('LlamaSwap production-frontend quote transport', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test('posts cross-origin from the production frontend with no credentials and bounded output', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(response({ text: '{"amountReturned":"1"}' }));
    (globalThis as any).fetch = fetchMock;

    const result = await requestLlamaSwapQuotesInPage(
      [request],
      window.location.origin,
      window.location.pathname,
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
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request.body),
      })
    );
  });

  test('rejects the wrong page origin before network contact', async () => {
    const fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;

    await expect(
      requestLlamaSwapQuotesInPage(
        [request],
        LLAMASWAP_FRONTEND_ORIGIN,
        LLAMASWAP_FRONTEND_PATH,
        2_000_000,
        20_000
      )
    ).resolves.toEqual([
      expect.objectContaining({
        protocol: '1inch',
        error: 'unexpected quote-page location',
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
      window.location.pathname,
      10,
      20_000
    );

    expect(results[0].error).toBe('quote request failed (403)');
    expect(results[1].error).toBe('quote response is too large');
  });

  test('opens one inactive production-frontend tab, uses the isolated world, and closes it', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 42,
      active: false,
      status: 'complete',
      url: `${LLAMASWAP_FRONTEND_ORIGIN}${LLAMASWAP_FRONTEND_PATH}`,
    });
    const get = jest.fn().mockResolvedValue({
      id: 42,
      active: false,
      status: 'complete',
      url: `${LLAMASWAP_FRONTEND_ORIGIN}${LLAMASWAP_FRONTEND_PATH}`,
    });
    const remove = jest.fn().mockResolvedValue(undefined);
    const executeScript = jest.fn().mockImplementation(async (options) => {
      expect(options.target).toEqual({ tabId: 42 });
      expect(options.world).toBe('ISOLATED');
      expect(options.func).toBe(requestLlamaSwapQuotesInPage);
      expect(options.args[0]).toEqual([request]);
      expect(options.args[1]).toBe(LLAMASWAP_FRONTEND_ORIGIN);
      expect(options.args[2]).toBe(LLAMASWAP_FRONTEND_PATH);
      return [
        {
          result: [
            {
              protocol: '1inch',
              origin: LLAMASWAP_FRONTEND_ORIGIN,
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
        origin: LLAMASWAP_FRONTEND_ORIGIN,
        text: '{}',
        error: undefined,
      },
    ]);
    expect(create).toHaveBeenCalledWith({
      url: `${LLAMASWAP_FRONTEND_ORIGIN}${LLAMASWAP_FRONTEND_PATH}`,
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
        url: `${LLAMASWAP_FRONTEND_ORIGIN}${LLAMASWAP_FRONTEND_PATH}`,
      })
      .mockResolvedValueOnce({
        id: 42,
        status: 'complete',
        url: `${LLAMASWAP_FRONTEND_ORIGIN}${LLAMASWAP_FRONTEND_PATH}`,
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
                origin: LLAMASWAP_FRONTEND_ORIGIN,
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

  test('rejects any request outside the exact API endpoint before opening a tab', async () => {
    const create = jest.fn();
    const api = {
      tabs: {
        create,
        get: jest.fn(),
        remove: jest.fn(),
        onUpdated: {
          addListener: jest.fn(),
          removeListener: jest.fn(),
        },
      },
      scripting: { executeScript: jest.fn() },
    } as any;

    await expect(
      fetchLlamaSwapQuotesFromOrigin(
        [
          {
            ...request,
            url: `${LLAMASWAP_FRONTEND_ORIGIN}/dexAggregatorQuote?protocol=1inch`,
          },
        ],
        2_000_000,
        api
      )
    ).rejects.toThrow('Invalid LlamaSwap quote transport request');
    expect(create).not.toHaveBeenCalled();
  });

  test('rejects a same-origin redirect away from the static transport path and closes the tab', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const api = {
      tabs: {
        create: jest.fn().mockResolvedValue({ id: 42 }),
        get: jest.fn().mockResolvedValue({
          id: 42,
          status: 'complete',
          url: `${LLAMASWAP_FRONTEND_ORIGIN}/`,
        }),
        remove,
        onUpdated: {
          addListener: jest.fn(),
          removeListener: jest.fn(),
        },
      },
      scripting: { executeScript: jest.fn() },
    } as any;

    await expect(
      fetchLlamaSwapQuotesFromOrigin([request], 2_000_000, api)
    ).rejects.toThrow('unexpected location');
    expect(remove).toHaveBeenCalledWith(42);
  });

  test('closes the temporary tab when injection fails', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const api = {
      tabs: {
        create: jest.fn().mockResolvedValue({ id: 42 }),
        get: jest.fn().mockResolvedValue({
          id: 42,
          status: 'complete',
          url: `${LLAMASWAP_FRONTEND_ORIGIN}${LLAMASWAP_FRONTEND_PATH}`,
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
