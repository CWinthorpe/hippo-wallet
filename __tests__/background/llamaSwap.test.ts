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
  findChain: jest.fn(({ serverId }) => ({
    enum: String(serverId || 'eth').toUpperCase(),
    serverId: serverId || 'eth',
    id: 1,
    nativeTokenSymbol: 'ETH',
    nativeTokenAddress: 'eth',
  })),
}));

import { ethers } from 'ethers';
import RPCService from '@/background/service/rpc';
import {
  KYBERSWAP_ROUTER,
  LLAMASWAP_NATIVE_TOKEN,
  MATCHA_PROTOCOL,
  ONEINCH_ROUTER,
  PARASWAP_LLAMASWAP_PARTNER,
  PARASWAP_ROUTER,
  PERMIT2_ADDRESS,
  ZEROX_LLAMASWAP_AFFILIATE,
} from '@/constant/llama-swap';
import {
  LlamaSwapQuoteRequest,
  LlamaSwapService,
  validateLlamaSwapQuote,
} from '@/background/service/llamaSwap';

const recipient = '0x1111111111111111111111111111111111111111';
const fromToken = '0x2222222222222222222222222222222222222222';
const toToken = '0x3333333333333333333333333333333333333333';
const oneInchExecutor = '0x4444444444444444444444444444444444444444';
const matchaRouter = '0x5555555555555555555555555555555555555555';
const inputAmount = '1000000000000000000';
const matchaZid = '0x1234567890abcdef12345678';

const oneInchInterface = new ethers.utils.Interface([
  'function swap(address executor,(address srcToken,address dstToken,address srcReceiver,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags) desc,bytes data) payable returns (uint256 returnAmount,uint256 spentAmount)',
]);
const kyberInterface = new ethers.utils.Interface([
  'function swap((address,address,bytes,(address,address,address[],uint256[],address[],uint256[],address,uint256,uint256,uint256,bytes),bytes)) payable returns (uint256)',
]);
const paraSwapInterface = new ethers.utils.Interface([
  'function swapExactAmountIn(address executor,(address srcToken,address destToken,uint256 fromAmount,uint256 toAmount,uint256 quotedAmount,bytes32 metadata,address beneficiary) swapData,uint256 partnerAndFee,bytes permit,bytes executorData) payable returns (uint256 receivedAmount,uint256 paraswapShare,uint256 partnerShare)',
]);
const matchaInterface = new ethers.utils.Interface([
  'function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 zidAndAffiliate) payable returns (bool)',
]);

const nativeRequest: LlamaSwapQuoteRequest = {
  chainServerId: 'eth',
  fromToken: {
    address: LLAMASWAP_NATIVE_TOKEN,
    decimals: 18,
    symbol: 'ETH',
  },
  toToken: {
    address: toToken,
    decimals: 6,
    symbol: 'TO',
  },
  amount: inputAmount,
  userAddress: recipient,
  slippage: '1',
};

const erc20Request: LlamaSwapQuoteRequest = {
  ...nativeRequest,
  fromToken: {
    address: fromToken,
    decimals: 18,
    symbol: 'FROM',
  },
};

const minimum = (amountOut: string) =>
  ((BigInt(amountOut) * 9_900n) / 10_000n).toString();

const makeOneInchPayload = ({
  request = nativeRequest,
  amountOut = '1990000',
  receiver = recipient,
  minReturnAmount = minimum(amountOut),
} = {}) => ({
  amountReturned: amountOut,
  estimatedGas: 210000,
  tokenApprovalAddress: ONEINCH_ROUTER,
  rawQuote: {
    dstAmount: amountOut,
    tx: {
      from: request.userAddress,
      to: ONEINCH_ROUTER,
      data: oneInchInterface.encodeFunctionData('swap', [
        oneInchExecutor,
        [
          request.fromToken.address,
          request.toToken.address,
          oneInchExecutor,
          receiver,
          request.amount,
          minReturnAmount,
          0,
        ],
        '0x1234',
      ]),
      value:
        request.fromToken.address === LLAMASWAP_NATIVE_TOKEN
          ? request.amount
          : '0',
      gas: 0,
    },
  },
});

const makeKyberPayload = ({
  request = nativeRequest,
  amountOut = '2010000',
  receiver = recipient,
  feeAmounts = [] as string[],
  router = KYBERSWAP_ROUTER,
} = {}) => ({
  amountReturned: amountOut,
  estimatedGas: '220000',
  tokenApprovalAddress: router,
  rawQuote: {
    amountIn: request.amount,
    amountOut,
    data: kyberInterface.encodeFunctionData('swap', [
      [
        ethers.constants.AddressZero,
        ethers.constants.AddressZero,
        '0x',
        [
          request.fromToken.address,
          request.toToken.address,
          [],
          [],
          feeAmounts.map(() => recipient),
          feeAmounts,
          receiver,
          request.amount,
          minimum(amountOut),
          0,
          '0x',
        ],
        '0x',
      ],
    ]),
    routerAddress: router,
    transactionValue:
      request.fromToken.address === LLAMASWAP_NATIVE_TOKEN
        ? request.amount
        : '0',
    additionalCostUsd: 0,
    gas: '220000',
  },
});

const paraSwapPartnerAndFee = (feeData = 0n) =>
  ethers.BigNumber.from(PARASWAP_LLAMASWAP_PARTNER)
    .shl(96)
    .or(feeData);

const makeParaSwapPayload = ({
  request = nativeRequest,
  amountOut = '2020000',
  beneficiary = ethers.constants.AddressZero,
  partnerAndFee = paraSwapPartnerAndFee(),
} = {}) => ({
  amountReturned: amountOut,
  amountIn: request.amount,
  estimatedGas: '190000',
  tokenApprovalAddress: PARASWAP_ROUTER,
  rawQuote: {
    from: request.userAddress,
    to: PARASWAP_ROUTER,
    value:
      request.fromToken.address === LLAMASWAP_NATIVE_TOKEN
        ? request.amount
        : '0',
    chainId: 1,
    gasLimit: '190000',
    tokenApprovalAddress: PARASWAP_ROUTER,
    data: paraSwapInterface.encodeFunctionData('swapExactAmountIn', [
      '0x6666666666666666666666666666666666666666',
      [
        request.fromToken.address,
        request.toToken.address,
        request.amount,
        minimum(amountOut),
        amountOut,
        ethers.constants.HashZero,
        beneficiary,
      ],
      partnerAndFee,
      '0x',
      '0x1234',
    ]),
  },
});

const makeMatchaPayload = ({
  request = nativeRequest,
  amountOut = '2000000',
  router = matchaRouter,
  affiliate = ZEROX_LLAMASWAP_AFFILIATE,
  withPermit = request.fromToken.address !== LLAMASWAP_NATIVE_TOKEN,
} = {}) => {
  const deadline = String(Math.floor(Date.now() / 1000) + 300);
  const domain = {
    name: 'Permit2',
    chainId: 1,
    verifyingContract: PERMIT2_ADDRESS,
  };
  const permitFields = [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ];
  const tokenFields = [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ];
  const domainFields = [
    { name: 'name', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ];
  const message = {
    permitted: { token: request.fromToken.address, amount: request.amount },
    spender: router,
    nonce: '123456789',
    deadline,
  };
  const hash = ethers.utils._TypedDataEncoder.hash(
    domain,
    {
      PermitTransferFrom: permitFields,
      TokenPermissions: tokenFields,
    },
    message
  );
  const zidAndAffiliate = `${matchaZid}${affiliate
    .toLowerCase()
    .slice(2)}`;
  return {
    amountReturned: amountOut,
    amountIn: request.amount,
    estimatedGas: '230000',
    tokenApprovalAddress: PERMIT2_ADDRESS,
    isSignatureNeededForSwap: withPermit,
    rawQuote: {
      allowanceTarget: PERMIT2_ADDRESS,
      buyAmount: amountOut,
      buyToken: request.toToken.address,
      fees: {
        integratorFee: null,
        integratorFees: null,
        zeroExFee: null,
        gasFee: null,
      },
      liquidityAvailable: true,
      minBuyAmount: minimum(amountOut),
      sellAmount: request.amount,
      sellToken: request.fromToken.address,
      zid: matchaZid,
      permit2: withPermit
        ? {
            type: 'Permit2',
            hash,
            eip712: {
              types: {
                PermitTransferFrom: permitFields,
                EIP712Domain: domainFields,
                TokenPermissions: tokenFields,
              },
              domain,
              message,
              primaryType: 'PermitTransferFrom',
            },
          }
        : null,
      transaction: {
        to: router,
        value:
          request.fromToken.address === LLAMASWAP_NATIVE_TOKEN
            ? request.amount
            : '0',
        data: matchaInterface.encodeFunctionData('execute', [
          [request.userAddress, request.toToken.address, minimum(amountOut)],
          [],
          zidAndAffiliate,
        ]),
        gas: '230000',
      },
    },
  };
};

const responseForProtocol = (protocol: string) => {
  switch (protocol) {
    case '1inch':
      return makeOneInchPayload();
    case 'KyberSwap':
      return makeKyberPayload();
    case 'ParaSwap':
      return makeParaSwapPayload();
    case 'Matcha/0x v2':
      return makeMatchaPayload();
    default:
      throw new Error(`unexpected protocol ${protocol}`);
  }
};

const response = (payload: unknown, ok = true, status = 200) => ({
  ok,
  status,
  headers: { get: () => null },
  text: async () => JSON.stringify(payload),
});

describe('LlamaSwap multi-aggregator validation', () => {
  const fetchMock = jest.fn();
  const rpcMock = RPCService.requestDefaultRPC as jest.Mock;

  beforeEach(() => {
    fetchMock.mockReset();
    rpcMock.mockReset();
    (globalThis as any).fetch = fetchMock;
    rpcMock.mockResolvedValue(
      ethers.utils.defaultAbiCoder.encode(['address'], [matchaRouter])
    );
    fetchMock.mockImplementation(async (url: string) => {
      const protocol = new URL(url).searchParams.get('protocol') || '';
      return response(responseForProtocol(protocol));
    });
  });

  test('queries all ordinary adapters, excludes gasless, validates, and sorts routes', async () => {
    const quotes = await new LlamaSwapService().getQuotes(nativeRequest);

    expect(quotes.map((quote) => quote.provider)).toEqual([
      'ParaSwap',
      'KyberSwap',
      'Matcha/0x v2',
      '1inch',
    ]);
    expect(quotes[0].quoteSource).toBe('LlamaSwap frontend API');
    expect(quotes[0].providersCompared).toEqual([
      '1inch',
      'KyberSwap',
      'ParaSwap',
      'Matcha/0x v2',
    ]);
    expect(quotes[0].availableProviders).toEqual(
      quotes.map((quote) => quote.provider)
    );

    const protocols = fetchMock.mock.calls.map(([url]) =>
      new URL(url).searchParams.get('protocol')
    );
    expect(protocols).toEqual([
      '1inch',
      'KyberSwap',
      'ParaSwap',
      'Matcha/0x v2',
    ]);
    expect(protocols).not.toContain('0x Gasless');
    for (const [url, options] of fetchMock.mock.calls) {
      const protocol = new URL(url).searchParams.get('protocol');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toMatchObject({
        userAddress: recipient,
        slippage: protocol === MATCHA_PROTOCOL ? '0.99' : '1',
        isPrivacyEnabled: true,
      });
    }
  });

  test('drops a malformed provider response without collapsing valid routes', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const protocol = new URL(url).searchParams.get('protocol') || '';
      if (protocol === 'KyberSwap') {
        return response(makeKyberPayload({ feeAmounts: ['1'] }));
      }
      return response(responseForProtocol(protocol));
    });

    const quotes = await new LlamaSwapService().getQuotes(nativeRequest);
    expect(quotes.map((quote) => quote.provider)).toEqual([
      'ParaSwap',
      'Matcha/0x v2',
      '1inch',
    ]);
  });

  test('uses only adapters supported by the selected chain', async () => {
    const request = { ...nativeRequest, chainServerId: 'era' };
    fetchMock.mockResolvedValue(response(makeOneInchPayload()));

    const quotes = await new LlamaSwapService().getQuotes(request);
    expect(quotes).toHaveLength(1);
    expect(quotes[0].provider).toBe('1inch');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('chain=zksync');
  });

  test('fails closed when every adapter fails', async () => {
    fetchMock.mockResolvedValue(response({}, false, 403));
    await expect(
      new LlamaSwapService().getQuotes(nativeRequest)
    ).rejects.toThrow('No valid LlamaSwap routes');
  });

  test('validates 1inch recipient and minimum output from decoded calldata', () => {
    expect(
      validateLlamaSwapQuote(
        nativeRequest,
        makeOneInchPayload(),
        '1inch'
      ).provider
    ).toBe('1inch');
    expect(() =>
      validateLlamaSwapQuote(
        nativeRequest,
        makeOneInchPayload({
          receiver: '0x7777777777777777777777777777777777777777',
        }),
        '1inch'
      )
    ).toThrow('does not match the reviewed quote');
    expect(() =>
      validateLlamaSwapQuote(
        nativeRequest,
        makeOneInchPayload({ minReturnAmount: '1' }),
        '1inch'
      )
    ).toThrow('does not match the reviewed quote');
  });

  test('rejects KyberSwap route fees and wrong recipients', () => {
    expect(
      validateLlamaSwapQuote(
        nativeRequest,
        makeKyberPayload(),
        'KyberSwap'
      ).provider
    ).toBe('KyberSwap');
    expect(() =>
      validateLlamaSwapQuote(
        nativeRequest,
        makeKyberPayload({ feeAmounts: ['1'] }),
        'KyberSwap'
      )
    ).toThrow('unexpected fee');
    expect(() =>
      validateLlamaSwapQuote(
        nativeRequest,
        makeKyberPayload({
          receiver: '0x7777777777777777777777777777777777777777',
        }),
        'KyberSwap'
      )
    ).toThrow('does not match the reviewed quote');
  });

  test('allows only LlamaSwap ParaSwap attribution with a zero partner fee', () => {
    const quote = validateLlamaSwapQuote(
      nativeRequest,
      makeParaSwapPayload(),
      'ParaSwap'
    );
    expect(quote.provider).toBe('ParaSwap');
    expect(quote.approvalSpender).toBe(PARASWAP_ROUTER);

    expect(() =>
      validateLlamaSwapQuote(
        nativeRequest,
        makeParaSwapPayload({ partnerAndFee: paraSwapPartnerAndFee(1n) }),
        'ParaSwap'
      )
    ).toThrow('unexpected partner fee');
    expect(() =>
      validateLlamaSwapQuote(
        nativeRequest,
        makeParaSwapPayload({
          beneficiary: '0x7777777777777777777777777777777777777777',
        }),
        'ParaSwap'
      )
    ).toThrow('does not match the reviewed quote');
  });

  test('checks Matcha target against the 0x registry and rejects affiliates', () => {
    const quote = validateLlamaSwapQuote(
      nativeRequest,
      makeMatchaPayload(),
      MATCHA_PROTOCOL,
      matchaRouter
    );
    expect(quote.provider).toBe(MATCHA_PROTOCOL);
    expect(quote.transaction.to).toBe(matchaRouter);

    expect(() =>
      validateLlamaSwapQuote(
        nativeRequest,
        makeMatchaPayload(),
        MATCHA_PROTOCOL,
        '0x7777777777777777777777777777777777777777'
      )
    ).toThrow('not the active 0x Settler');
    expect(() =>
      validateLlamaSwapQuote(
        nativeRequest,
        makeMatchaPayload({
          affiliate: ethers.constants.AddressZero,
        }),
        MATCHA_PROTOCOL,
        matchaRouter
      )
    ).toThrow('does not match the reviewed quote');
  });

  test('validates exact Matcha Permit2 typed data for ERC-20 input', () => {
    const payload = makeMatchaPayload({ request: erc20Request });
    const quote = validateLlamaSwapQuote(
      erc20Request,
      payload,
      MATCHA_PROTOCOL,
      matchaRouter
    );
    expect(quote.permit2).toMatchObject({
      domain: {
        name: 'Permit2',
        chainId: 1,
        verifyingContract: PERMIT2_ADDRESS,
      },
      message: {
        permitted: { token: fromToken, amount: inputAmount },
        spender: matchaRouter,
      },
    });
    expect(quote.permit2?.hash).toBe(payload.rawQuote.permit2!.hash);

    const tampered = makeMatchaPayload({ request: erc20Request });
    tampered.rawQuote.permit2!.eip712.message.permitted.amount = '2';
    expect(() =>
      validateLlamaSwapQuote(
        erc20Request,
        tampered,
        MATCHA_PROTOCOL,
        matchaRouter
      )
    ).toThrow('does not match the reviewed quote');
  });

  test('rejects malformed transaction values rather than trusting the API', () => {
    const payload = makeOneInchPayload();
    payload.rawQuote.tx.value = '0';
    expect(() =>
      validateLlamaSwapQuote(nativeRequest, payload, '1inch')
    ).toThrow('native value mismatch');
  });

  test('caps API-supplied gas and calldata before returning a route', () => {
    const excessiveGas = makeOneInchPayload();
    excessiveGas.estimatedGas = 10_000_001;
    expect(() =>
      validateLlamaSwapQuote(nativeRequest, excessiveGas, '1inch')
    ).toThrow('gas estimate exceeds the local safety cap');

    const excessiveCalldata = makeOneInchPayload();
    excessiveCalldata.rawQuote.tx.data = `0x${'aa'.repeat(131_073)}`;
    expect(() =>
      validateLlamaSwapQuote(nativeRequest, excessiveCalldata, '1inch')
    ).toThrow('calldata exceeds the local safety cap');
  });
});
