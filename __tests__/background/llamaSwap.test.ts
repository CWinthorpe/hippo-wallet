/**
 * @jest-environment jsdom
 */

jest.mock('@/background/service/rpc', () => ({
  __esModule: true,
  default: {
    hasCustomRPC: jest.fn(() => false),
    requestDefaultRPC: jest.fn(),
    requestCustomRPC: jest.fn(),
  },
}));

jest.mock('@/utils/chain', () => ({
  findChain: jest.fn(() => ({
    enum: 'ETH',
    serverId: 'eth',
    nativeTokenSymbol: 'ETH',
    nativeTokenAddress: 'eth',
  })),
}));

import {
  KYBERSWAP_ROUTER,
  LLAMASWAP_NATIVE_TOKEN,
} from '@/constant/llama-swap';
import { LlamaSwapService } from '@/background/service/llamaSwap';
import { ethers } from 'ethers';

const recipient = '0x1111111111111111111111111111111111111111';
const fromToken = '0x2222222222222222222222222222222222222222';
const toToken = '0x3333333333333333333333333333333333333333';

const kyberInterface = new ethers.utils.Interface([
  'function swap((address,address,bytes,(address,address,address[],uint256[],address[],uint256[],address,uint256,uint256,uint256,bytes),bytes)) payable returns (uint256)',
]);

const makeCalldata = ({
  from = fromToken,
  to = toToken,
  receiver = recipient,
  feeAmounts = [],
}: {
  from?: string;
  to?: string;
  receiver?: string;
  feeAmounts?: string[];
} = {}) =>
  kyberInterface.encodeFunctionData('swap', [
    [
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
      '0x',
      [
        from,
        to,
        [],
        [],
        feeAmounts.map(() => recipient),
        feeAmounts,
        receiver,
        '1000000000000000000',
        '1970100',
        0,
        '0x',
      ],
      '0x',
    ],
  ]);

const makePayload = (overrides: Record<string, unknown> = {}) => {
  const { rawQuote: rawQuoteOverrides, ...rest } = overrides;
  return {
    amountReturned: '1990000',
    estimatedGas: '180000',
    tokenApprovalAddress: KYBERSWAP_ROUTER,
    rawQuote: {
      amountIn: '1000000000000000000',
      amountOut: '1990000',
      data: makeCalldata(),
      routerAddress: KYBERSWAP_ROUTER,
      transactionValue: '0',
      additionalCostUsd: 0,
      ...((rawQuoteOverrides as object) || {}),
    },
    ...rest,
  };
};

const request = {
  chainServerId: 'eth',
  fromToken: {
    address: fromToken,
    decimals: 18,
    symbol: 'FROM',
  },
  toToken: {
    address: toToken,
    decimals: 6,
    symbol: 'TO',
  },
  amount: '1000000000000000000',
  userAddress: recipient,
  slippage: '1',
};

describe('LlamaSwap frontend quote validation', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    (globalThis as any).fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => makePayload(),
    });
  });

  test('builds a validated same-chain KyberSwap transaction', async () => {
    const quote = await new LlamaSwapService().getQuote(request);

    expect(quote.provider).toBe('KyberSwap via LlamaSwap');
    expect(quote.chainServerId).toBe('eth');
    expect(quote.fromToken).toBe(fromToken);
    expect(quote.toToken).toBe(toToken);
    expect(quote.transaction.from).toBe(recipient);
    expect(quote.approvalSpender).toBe(KYBERSWAP_ROUTER);
    expect(quote.transaction).toEqual({
      from: recipient,
      to: KYBERSWAP_ROUTER,
      data: makeCalldata(),
      value: '0',
      gas: '0x2bf20',
    });
    expect(BigInt(quote.minimumAmountOut)).toBeLessThanOrEqual(
      BigInt(quote.amountOut)
    );

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain(
      'https://swap-api.defillama.com/dexAggregatorQuote?'
    );
    expect(url).toContain('protocol=KyberSwap');
    expect(options.method).toBe('POST');
    const body = JSON.parse(options.body);
    expect(body).toMatchObject({
      userAddress: recipient,
      slippage: '1',
      isPrivacyEnabled: true,
    });
    expect(body).not.toHaveProperty('fee');
    expect(body).not.toHaveProperty('referrer');
    expect(body).not.toHaveProperty('affiliate');
  });

  test('rejects an unapproved transaction target', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () =>
        makePayload({
          rawQuote: {
            routerAddress: '0x4444444444444444444444444444444444444444',
          },
        }),
    });

    await expect(new LlamaSwapService().getQuote(request)).rejects.toThrow(
      'unapproved router or spender'
    );
  });

  test('rejects calldata with the wrong recipient', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () =>
        makePayload({
          rawQuote: {
            data: makeCalldata({
              receiver: '0x4444444444444444444444444444444444444444',
            }),
          },
        }),
    });

    await expect(new LlamaSwapService().getQuote(request)).rejects.toThrow(
      'does not match the reviewed quote'
    );
  });

  test('rejects calldata with an affiliate fee', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () =>
        makePayload({
          rawQuote: {
            data: makeCalldata({ feeAmounts: ['1'] }),
          },
        }),
    });

    await expect(new LlamaSwapService().getQuote(request)).rejects.toThrow(
      'unexpected fee'
    );
  });

  test('sets native value only for a native input amount', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () =>
        makePayload({
          rawQuote: {
            transactionValue: request.amount,
            data: makeCalldata({ from: LLAMASWAP_NATIVE_TOKEN }),
          },
        }),
    });

    const nativeQuote = await new LlamaSwapService().getQuote({
      ...request,
      fromToken: {
        ...request.fromToken,
        address: LLAMASWAP_NATIVE_TOKEN,
      },
    });
    expect(nativeQuote.transaction.value).toBe(request.amount);
  });

  test('fails closed on frontend API errors', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'blocked',
      json: async () => ({}),
    });

    await expect(new LlamaSwapService().getQuote(request)).rejects.toThrow(
      'quote failed (403)'
    );
  });
});
