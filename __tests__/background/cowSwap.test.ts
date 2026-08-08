import { ethers } from 'ethers';

import RPCService from '@/background/service/rpc';
import {
  CowSwapService,
  __cowSwapTestUtils,
} from '@/background/service/cowSwap';
import type {
  CowSwapTransport,
  CowSwapTransportRequest,
  CowSwapTransportResponse,
} from '@/background/service/cowSwapTransport';
import {
  COW_SWAP_CHAIN_CONFIG_BY_ID,
  COW_SWAP_MAX_VALID_TO,
  COW_SWAP_NATIVE_TOKEN,
} from '@/constant/cow-swap';

jest.mock('@/background/service/rpc', () => ({
  __esModule: true,
  default: {
    hasCustomRPC: jest.fn(() => false),
    requestCustomRPC: jest.fn(),
    requestDefaultRPC: jest.fn(),
  },
}));

jest.mock('@/utils/chain', () => ({
  findChain: jest.fn(({ serverId, id }) => {
    if (serverId === 'eth' || id === 1) {
      return {
        id: 1,
        serverId: 'eth',
        enum: 'ETH',
        nativeTokenSymbol: 'ETH',
      };
    }
    return undefined;
  }),
}));

const NOW_MS = 1_785_643_200_000;
const OWNER_WALLET = new ethers.Wallet(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
);
const OTHER_WALLET = new ethers.Wallet(
  '0x8b3a350cf5c34c9194ca3a545d136b51f60f7f2c3d9f8f7d4f8d9d8b7c6a5e4d'
);
const OWNER = OWNER_WALLET.address.toLowerCase();
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const SELL_AMOUNT = '1000000000000000';
const NETWORK_FEE = '41311774894023';
const SELL_AFTER_FEE = (BigInt(SELL_AMOUNT) - BigInt(NETWORK_FEE)).toString();
const BUY_AMOUNT = '1790460';
const MAINNET = COW_SWAP_CHAIN_CONFIG_BY_ID[1];

const withoutDomainType = (
  types: Record<string, Array<{ name: string; type: string }>>
) =>
  Object.fromEntries(
    Object.entries(types).filter(([name]) => name !== 'EIP712Domain')
  );

const jsonResponse = (
  status: number,
  value: unknown
): CowSwapTransportResponse => ({
  status,
  text: JSON.stringify(value),
  contentType: 'application/json',
});

const setupRpc = () => {
  (RPCService.requestDefaultRPC as jest.Mock).mockImplementation(
    async ({ method, params }) => {
      if (method === 'eth_getBalance')
        return ethers.BigNumber.from('10000000000000000000').toHexString();
      if (method === 'eth_estimateGas') return '0x30d40';
      if (method === 'eth_getCode') {
        return String(params[0]).toLowerCase() === OWNER
          ? '0x'
          : '0x6001600055';
      }
      if (method === 'eth_call') {
        const call = params[0];
        const token = String(call.to).toLowerCase();
        const selector = String(call.data).slice(0, 10).toLowerCase();
        if (
          token === MAINNET.ethFlowContract &&
          selector ===
            __cowSwapTestUtils.ETH_FLOW_INTERFACE.getSighash('orders')
        ) {
          return __cowSwapTestUtils.ETH_FLOW_INTERFACE.encodeFunctionResult(
            'orders',
            [OWNER, Math.floor(NOW_MS / 1000) + 600]
          );
        }
        if (selector === '0x313ce567') {
          return ethers.utils.hexValue(token === USDC ? 6 : 18);
        }
        if (selector === '0x95d89b41') {
          return ethers.utils.defaultAbiCoder.encode(
            ['string'],
            [token === USDC ? 'USDC' : 'WETH']
          );
        }
        if (selector === '0x70a08231') {
          return ethers.BigNumber.from(
            token === WETH ? '10000000000000000000' : '0'
          ).toHexString();
        }
      }
      throw new Error(`Unexpected RPC call ${method}`);
    }
  );
};

const quoteRequest = (fromAddress = WETH) => ({
  chainServerId: 'eth',
  fromToken: {
    address: fromAddress,
    decimals: 18,
    symbol: fromAddress === COW_SWAP_NATIVE_TOKEN ? 'ETH' : 'WETH',
  },
  toToken: { address: USDC, decimals: 6, symbol: 'USDC' },
  amount: SELL_AMOUNT,
  userAddress: OWNER,
  slippage: '0.5',
});

const makeQuoteBody = (requestBody: Record<string, any>) => ({
  id: 123456789,
  expiration: new Date(
    NOW_MS + (requestBody.onchainOrder ? 3 * 60 * 60 : 10 * 60) * 1000
  )
    .toISOString()
    .replace(/Z$/, '123456Z'),
  quote: {
    sellToken: requestBody.sellToken,
    buyToken: requestBody.buyToken,
    receiver: requestBody.receiver,
    sellAmount: SELL_AFTER_FEE,
    buyAmount: BUY_AMOUNT,
    validTo: Math.floor(NOW_MS / 1000) + 600,
    appData: requestBody.appData,
    appDataHash: requestBody.appDataHash,
    feeAmount: NETWORK_FEE,
    gasAmount: '215931',
    gasPrice: '191319333',
    sellTokenPrice: '1',
    kind: 'sell',
    partiallyFillable: false,
    sellTokenBalance: 'erc20',
    buyTokenBalance: 'erc20',
    signingScheme: requestBody.signingScheme,
  },
  from: requestBody.from,
  protocolFeeBps: '2',
  verified: true,
});

const makeTransport = (
  handler?: (
    request: CowSwapTransportRequest,
    parsedBody?: Record<string, any>
  ) => Promise<CowSwapTransportResponse> | CowSwapTransportResponse
) => {
  const transport = jest.fn(async (request: CowSwapTransportRequest) => {
    const parsedBody = request.body ? JSON.parse(request.body) : undefined;
    if (handler) {
      const handled = await handler(request, parsedBody);
      if (handled) return handled;
    }
    if (request.url.endsWith('/api/v1/quote')) {
      return jsonResponse(200, makeQuoteBody(parsedBody));
    }
    if (request.method === 'GET' && request.url.includes('/api/v1/orders/')) {
      return jsonResponse(404, {
        errorType: 'NotFound',
        description: 'Order was not found',
      });
    }
    throw new Error(
      `Unhandled transport request ${request.method} ${request.url}`
    );
  });
  return transport as jest.MockedFunction<CowSwapTransport>;
};

const makeApiOrder = (
  quote: Awaited<ReturnType<CowSwapService['getQuote']>>,
  overrides: Record<string, any> = {}
) => {
  const message = quote.signingPayload!.message;
  return {
    uid: quote.expectedOrderUid,
    owner: OWNER,
    status: 'open',
    sellToken: message.sellToken,
    buyToken: message.buyToken,
    receiver: message.receiver,
    sellAmount: message.sellAmount,
    buyAmount: message.buyAmount,
    validTo: message.validTo,
    appData: message.appData,
    feeAmount: message.feeAmount,
    kind: message.kind,
    partiallyFillable: message.partiallyFillable,
    sellTokenBalance: message.sellTokenBalance,
    buyTokenBalance: message.buyTokenBalance,
    creationDate: new Date(NOW_MS).toISOString(),
    executedSellAmount: '0',
    executedBuyAmount: '0',
    executedFeeAmount: '0',
    ...overrides,
  };
};

describe('CowSwapService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    setupRpc();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('builds a verified EIP-712 sell order and fixed vault-relayer approval', async () => {
    let postedQuote: any;
    const transport = makeTransport((request, body) => {
      if (request.url.endsWith('/api/v1/quote')) postedQuote = body;
      return undefined as any;
    });
    const service = new CowSwapService(transport);
    const quote = await service.getQuote(quoteRequest());

    expect(postedQuote).toMatchObject({
      sellToken: WETH,
      buyToken: USDC,
      from: OWNER,
      receiver: OWNER,
      sellAmountBeforeFee: SELL_AMOUNT,
      kind: 'sell',
      signingScheme: 'eip712',
      priceQuality: 'optimal',
      validFor: 600,
    });
    expect(postedQuote.appData).toContain('Hippo Wallet');
    expect(
      ethers.utils.keccak256(ethers.utils.toUtf8Bytes(postedQuote.appData))
    ).toBe(postedQuote.appDataHash);
    expect(quote).toMatchObject({
      provider: 'CoW Swap',
      chainId: 1,
      amountIn: SELL_AMOUNT,
      amountOut: BUY_AMOUNT,
      minimumAmountOut: '1781508',
      networkFeeAmount: NETWORK_FEE,
      protocolFeeBps: 2,
      slippageBps: 50,
      approvalSpender: MAINNET.vaultRelayer,
      nativeSell: false,
    });
    expect(quote.signingPayload).toMatchObject({
      domain: {
        name: 'Gnosis Protocol',
        version: 'v2',
        chainId: 1,
        verifyingContract: MAINNET.settlementContract,
      },
      primaryType: 'Order',
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'chainId', type: 'uint256' },
          { name: 'verifyingContract', type: 'address' },
        ],
      },
      message: {
        sellToken: WETH,
        buyToken: USDC,
        receiver: OWNER,
        sellAmount: SELL_AMOUNT,
        buyAmount: '1781508',
        feeAmount: '0',
        kind: 'sell',
        partiallyFillable: false,
        sellTokenBalance: 'erc20',
        buyTokenBalance: 'erc20',
      },
    });
    expect(quote.expectedOrderUid).toMatch(/^0x[0-9a-f]{112}$/);
    expect(__cowSwapTestUtils.parseOrderUid(quote.expectedOrderUid).owner).toBe(
      OWNER
    );
  });

  test('rejects native execution from a contract account', async () => {
    const requestRpc = RPCService.requestDefaultRPC as jest.Mock;
    const originalImplementation = requestRpc.getMockImplementation()!;
    requestRpc.mockImplementation(async (request) => {
      if (
        request.method === 'eth_getCode' &&
        String(request.params[0]).toLowerCase() === OWNER
      ) {
        return '0x6001600055';
      }
      return originalImplementation(request);
    });
    const service = new CowSwapService(makeTransport());

    await expect(
      service.getQuote(quoteRequest(COW_SWAP_NATIVE_TOKEN))
    ).rejects.toThrow('externally owned account');
  });

  test('allows native execution from an EIP-7702 delegated EOA', async () => {
    const requestRpc = RPCService.requestDefaultRPC as jest.Mock;
    const originalImplementation = requestRpc.getMockImplementation()!;
    requestRpc.mockImplementation(async (request) => {
      if (
        request.method === 'eth_getCode' &&
        String(request.params[0]).toLowerCase() === OWNER
      ) {
        return `0xef0100${'11'.repeat(20)}`;
      }
      return originalImplementation(request);
    });
    const service = new CowSwapService(makeTransport());

    await expect(
      service.getQuote(quoteRequest(COW_SWAP_NATIVE_TOKEN))
    ).resolves.toMatchObject({ nativeSell: true });
  });

  test('signs and submits only the exact stored order', async () => {
    let expectedUid = '';
    let submittedBody: any;
    const transport = makeTransport((request, body) => {
      if (request.method === 'POST' && request.url.endsWith('/api/v1/orders')) {
        submittedBody = body;
        return jsonResponse(201, expectedUid);
      }
      return undefined as any;
    });
    const service = new CowSwapService(transport);
    const quote = await service.getQuote(quoteRequest());
    expectedUid = quote.expectedOrderUid;
    const signature = await OWNER_WALLET._signTypedData(
      quote.signingPayload!.domain,
      withoutDomainType(quote.signingPayload!.types),
      quote.signingPayload!.message
    );
    const result = await service.submitOrder({
      quoteHandle: quote.quoteHandle,
      chainServerId: 'eth',
      userAddress: OWNER,
      signature,
    });

    expect(result).toEqual({
      orderUid: expectedUid,
      explorerUrl: quote.explorerUrl,
      status: 'open',
    });
    const {
      appData: signedAppData,
      ...signedOrder
    } = quote.signingPayload!.message;
    expect(submittedBody).toMatchObject({
      ...signedOrder,
      from: OWNER,
      signature,
      signingScheme: 'eip712',
      quoteId: 123456789,
      appDataHash: signedAppData,
      fullBalanceCheck: true,
    });
    expect(submittedBody.appData).toContain('Hippo Wallet');
    await expect(
      service.submitOrder({
        quoteHandle: quote.quoteHandle,
        chainServerId: 'eth',
        userAddress: OWNER,
        signature,
      })
    ).rejects.toThrow('already used');
  });

  test('rejects a signature from another account before API submission', async () => {
    const transport = makeTransport();
    const service = new CowSwapService(transport);
    const quote = await service.getQuote(quoteRequest());
    const signature = await OTHER_WALLET._signTypedData(
      quote.signingPayload!.domain,
      withoutDomainType(quote.signingPayload!.types),
      quote.signingPayload!.message
    );
    await expect(
      service.submitOrder({
        quoteHandle: quote.quoteHandle,
        chainServerId: 'eth',
        userAddress: OWNER,
        signature,
      })
    ).rejects.toThrow('does not recover the active account');
    expect(
      transport.mock.calls.filter(([request]: [CowSwapTransportRequest]) =>
        request.url.endsWith('/orders')
      )
    ).toHaveLength(0);
  });

  test('recovers a deterministic order UID after an ambiguous submission error', async () => {
    let apiOrder: any;
    const transport = makeTransport((request) => {
      if (request.method === 'POST' && request.url.endsWith('/api/v1/orders')) {
        throw new Error('connection closed after upload');
      }
      if (request.method === 'GET' && request.url.includes('/orders/')) {
        return apiOrder ? jsonResponse(200, apiOrder) : jsonResponse(404, {});
      }
      return undefined as any;
    });
    const service = new CowSwapService(transport);
    const quote = await service.getQuote(quoteRequest());
    apiOrder = makeApiOrder(quote);
    const signature = await OWNER_WALLET._signTypedData(
      quote.signingPayload!.domain,
      withoutDomainType(quote.signingPayload!.types),
      quote.signingPayload!.message
    );
    await expect(
      service.submitOrder({
        quoteHandle: quote.quoteHandle,
        chainServerId: 'eth',
        userAddress: OWNER,
        signature,
      })
    ).resolves.toEqual({
      orderUid: quote.expectedOrderUid,
      explorerUrl: quote.explorerUrl,
      status: 'open',
    });
  });

  test.each([
    ['owner', (body: any) => ({ from: OTHER_WALLET.address })],
    [
      'sell token',
      (body: any) => ({ quote: { ...body.quote, sellToken: USDC } }),
    ],
    [
      'receiver',
      (body: any) => ({
        quote: { ...body.quote, receiver: OTHER_WALLET.address },
      }),
    ],
    [
      'app data',
      (body: any) => ({
        quote: { ...body.quote, appDataHash: `0x${'11'.repeat(32)}` },
      }),
    ],
    ['verification', () => ({ verified: false })],
    [
      'signing scheme',
      (body: any) => ({ quote: { ...body.quote, signingScheme: 'eip1271' } }),
    ],
  ])('fails closed on a mismatched quote %s', async (_label, mutate) => {
    const transport = makeTransport((request, parsed) => {
      if (!request.url.endsWith('/quote')) return undefined as any;
      const base = makeQuoteBody(parsed!);
      const patch: any = mutate(base);
      return jsonResponse(200, {
        ...base,
        ...patch,
        quote: patch.quote || base.quote,
      });
    });
    await expect(
      new CowSwapService(transport).getQuote(quoteRequest())
    ).rejects.toThrow();
  });

  test('constructs a unique official EthFlow deposit transaction for native input', async () => {
    const transport = makeTransport();
    const service = new CowSwapService(transport);
    const quote = await service.getQuote(quoteRequest(COW_SWAP_NATIVE_TOKEN));

    expect(quote).toMatchObject({
      nativeSell: true,
      approvalSpender: null,
      signingPayload: null,
      fromToken: COW_SWAP_NATIVE_TOKEN,
    });
    expect(__cowSwapTestUtils.parseOrderUid(quote.expectedOrderUid)).toEqual({
      uid: quote.expectedOrderUid,
      owner: MAINNET.ethFlowContract,
      validTo: COW_SWAP_MAX_VALID_TO,
    });
    const prepared = await service.consumeNativeOrder({
      quoteHandle: quote.quoteHandle,
      chainServerId: 'eth',
      userAddress: OWNER,
    });
    expect(prepared.transaction).toMatchObject({
      from: OWNER,
      to: MAINNET.ethFlowContract,
      value: ethers.utils.hexValue(ethers.BigNumber.from(SELL_AMOUNT)),
      gas: '0x3a980',
    });
    const decoded = __cowSwapTestUtils.ETH_FLOW_INTERFACE.decodeFunctionData(
      'createOrder',
      prepared.transaction.data
    )[0];
    expect(decoded.buyToken.toLowerCase()).toBe(USDC);
    expect(decoded.receiver.toLowerCase()).toBe(OWNER);
    expect(decoded.sellAmount.toString()).toBe(SELL_AMOUNT);
    expect(decoded.buyAmount.toString()).toBe(quote.minimumAmountOut);
    expect(decoded.validTo).toBe(Math.floor(NOW_MS / 1000) + 600);
    expect(decoded.quoteId.toString()).toBe('123456789');
    await expect(
      service.consumeNativeOrder({
        quoteHandle: quote.quoteHandle,
        chainServerId: 'eth',
        userAddress: OWNER,
      })
    ).rejects.toThrow('already used');
  });

  test('validates live order status against its EIP-712 UID and owner', async () => {
    let apiOrder: any;
    const transport = makeTransport((request) => {
      if (request.method === 'GET' && request.url.includes('/orders/')) {
        return apiOrder ? jsonResponse(200, apiOrder) : jsonResponse(404, {});
      }
      return undefined as any;
    });
    const service = new CowSwapService(transport);
    const quote = await service.getQuote(quoteRequest());
    apiOrder = makeApiOrder(quote, {
      status: 'fulfilled',
      executedSellAmount: SELL_AMOUNT,
      executedBuyAmount: '1800000',
      executedFeeAmount: '0',
      txHash: `0x${'ab'.repeat(32)}`,
    });
    const status = await service.getOrderStatus({
      chainServerId: 'eth',
      orderUid: quote.expectedOrderUid,
      ownerAddress: OWNER,
    });
    expect(status).toMatchObject({
      status: 'fulfilled',
      owner: OWNER,
      sender: null,
      executedSellAmount: SELL_AMOUNT,
      executedBuyAmount: '1800000',
      settlementTxHash: `0x${'ab'.repeat(32)}`,
      isNativeSell: false,
      terminal: true,
    });

    apiOrder = { ...apiOrder, buyAmount: '1' };
    await expect(
      service.getOrderStatus({
        chainServerId: 'eth',
        orderUid: quote.expectedOrderUid,
        ownerAddress: OWNER,
      })
    ).rejects.toThrow('does not match UID');
  });

  test('signs and submits an off-chain cancellation for an open EOA order', async () => {
    let apiOrder: any;
    let cancellationBody: any;
    const transport = makeTransport((request, body) => {
      if (request.method === 'GET' && request.url.includes('/orders/')) {
        return apiOrder ? jsonResponse(200, apiOrder) : jsonResponse(404, {});
      }
      if (request.method === 'DELETE') {
        cancellationBody = body;
        apiOrder = { ...apiOrder, status: 'cancelled' };
        return { status: 200, text: '', contentType: '' };
      }
      return undefined as any;
    });
    const service = new CowSwapService(transport);
    const quote = await service.getQuote(quoteRequest());
    apiOrder = makeApiOrder(quote);
    const prepared = await service.prepareCancellation({
      chainServerId: 'eth',
      orderUid: quote.expectedOrderUid,
      ownerAddress: OWNER,
    });
    expect(prepared.type).toBe('signature');
    if (prepared.type !== 'signature')
      throw new Error('wrong cancellation type');
    const signature = await OWNER_WALLET._signTypedData(
      prepared.signingPayload.domain,
      withoutDomainType(prepared.signingPayload.types),
      prepared.signingPayload.message
    );
    (Date.now as jest.Mock).mockReturnValue(NOW_MS + 3 * 60 * 1000);
    const result = await service.submitCancellation({
      cancellationHandle: prepared.cancellationHandle,
      chainServerId: 'eth',
      ownerAddress: OWNER,
      signature,
    });
    expect(result).toEqual({
      orderUid: quote.expectedOrderUid,
      status: 'cancelled',
    });
    expect(cancellationBody).toEqual({
      orderUids: [quote.expectedOrderUid],
      signature,
      signingScheme: 'eip712',
    });
  });

  test('builds the exact on-chain invalidation and refund transaction for EthFlow', async () => {
    let apiOrder: any;
    let quotedAppData = '';
    let quotedAppDataHash = '';
    const transport = makeTransport((request, body) => {
      if (request.url.endsWith('/quote')) {
        quotedAppData = body!.appData;
        quotedAppDataHash = body!.appDataHash;
      }
      if (request.method === 'GET' && request.url.includes('/orders/')) {
        return apiOrder ? jsonResponse(200, apiOrder) : jsonResponse(404, {});
      }
      return undefined as any;
    });
    const service = new CowSwapService(transport);
    const quote = await service.getQuote(quoteRequest(COW_SWAP_NATIVE_TOKEN));
    const userValidTo = Math.floor(quote.expiresAt / 1000);
    apiOrder = {
      uid: quote.expectedOrderUid,
      owner: MAINNET.ethFlowContract,
      status: 'open',
      sellToken: WETH,
      buyToken: USDC,
      receiver: OWNER,
      sellAmount: SELL_AMOUNT,
      buyAmount: quote.minimumAmountOut,
      validTo: COW_SWAP_MAX_VALID_TO,
      appData: quotedAppData,
      appDataHash: quotedAppDataHash,
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
      creationDate: new Date(NOW_MS).toISOString(),
      executedSellAmount: '0',
      executedBuyAmount: '0',
      executedFeeAmount: '0',
      onchainOrderData: { sender: OWNER },
      ethflowData: { userValidTo, refundTxHash: null },
    };
    const status = await service.getOrderStatus({
      chainServerId: 'eth',
      orderUid: quote.expectedOrderUid,
      ownerAddress: OWNER,
    });
    expect(status).toMatchObject({
      status: 'open',
      sender: OWNER,
      owner: MAINNET.ethFlowContract,
      validTo: userValidTo,
      isNativeSell: true,
    });

    apiOrder = { ...apiOrder, status: 'expired' };
    (RPCService.requestDefaultRPC as jest.Mock).mockImplementationOnce(
      async ({ method }) => {
        expect(method).toBe('eth_call');
        return __cowSwapTestUtils.ETH_FLOW_INTERFACE.encodeFunctionResult(
          'orders',
          [OTHER_WALLET.address, userValidTo]
        );
      }
    );
    await expect(
      service.prepareCancellation({
        chainServerId: 'eth',
        orderUid: quote.expectedOrderUid,
        ownerAddress: OWNER,
      })
    ).rejects.toThrow('on-chain order ownership mismatch');

    const prepared = await service.prepareCancellation({
      chainServerId: 'eth',
      orderUid: quote.expectedOrderUid,
      ownerAddress: OWNER,
    });
    expect(prepared.type).toBe('transaction');
    if (prepared.type !== 'transaction')
      throw new Error('wrong cancellation type');
    expect(prepared.transaction).toMatchObject({
      from: OWNER,
      to: MAINNET.ethFlowContract,
      value: '0x0',
      gas: '0x3a980',
    });
    const decoded = __cowSwapTestUtils.ETH_FLOW_INTERFACE.decodeFunctionData(
      'invalidateOrder',
      prepared.transaction.data
    )[0];
    expect(decoded.buyToken.toLowerCase()).toBe(USDC);
    expect(decoded.receiver.toLowerCase()).toBe(OWNER);
    expect(decoded.sellAmount.toString()).toBe(SELL_AMOUNT);
    expect(decoded.buyAmount.toString()).toBe(quote.minimumAmountOut);
    expect(decoded.appData.toLowerCase()).toBe(quotedAppDataHash);
    expect(decoded.validTo).toBe(userValidTo);
    expect(decoded.quoteId.toString()).toBe('0');
  });

  test('surfaces bounded structured API errors without returning raw HTML', async () => {
    const transport = makeTransport((request) => {
      if (request.url.endsWith('/quote')) {
        return {
          status: 400,
          text: JSON.stringify({
            errorType: 'UnsupportedToken',
            description: 'The sell token is not tradable',
          }),
          contentType: 'application/json',
        };
      }
      return undefined as any;
    });
    await expect(
      new CowSwapService(transport).getQuote(quoteRequest())
    ).rejects.toThrow(
      'CoW quote failed (400): UnsupportedToken: The sell token is not tradable'
    );
  });
});
