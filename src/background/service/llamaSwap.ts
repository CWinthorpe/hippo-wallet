import { ethers } from 'ethers';
import RPCService from './rpc';
import { findChain } from '@/utils/chain';
import {
  KYBERSWAP_ROUTER,
  LLAMASWAP_NATIVE_TOKEN,
  LLAMASWAP_PROTOCOLS_BY_CHAIN,
  LlamaSwapProtocol,
  ONEINCH_ROUTER,
  PARASWAP_LLAMASWAP_PARTNER,
  PARASWAP_ROUTER,
  PERMIT2_ADDRESS,
  ZEROX_SETTLER_DEPLOYER,
  ZEROX_LLAMASWAP_AFFILIATE,
  ZEROX_TAKER_SUBMITTED_FEATURE,
} from '@/constant/llama-swap';

const LLAMASWAP_QUOTE_ENDPOINT =
  'https://swap-api.defillama.com/dexAggregatorQuote';
const LLAMASWAP_PUBLIC_FRONTEND_KEY = [
  'nsr_UYWxuvj1hOCgHxJhDEKZ0g30c4Be3I5',
  'fOMBtFAA',
].join('');
const QUOTE_LIFETIME_MS = 30_000;
const MATCHA_PERMIT_MAX_LIFETIME_SECONDS = 10 * 60;
const MAX_RESPONSE_CHARACTERS = 2_000_000;
const MAX_CALLDATA_BYTES = 131_072;
const MAX_SWAP_GAS = 10_000_000n;

const LLAMASWAP_CHAIN_BY_SERVER_ID: Record<string, string> = {
  eth: 'ethereum',
  bsc: 'bsc',
  matic: 'polygon',
  op: 'optimism',
  arb: 'arbitrum',
  avax: 'avax',
  xdai: 'gnosis',
  era: 'zksync',
  base: 'base',
  linea: 'linea',
  sonic: 'sonic',
  unichain: 'unichain',
};

const ONEINCH_INTERFACE = new ethers.utils.Interface([
  'function swap(address executor,(address srcToken,address dstToken,address srcReceiver,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags) desc,bytes data) payable returns (uint256 returnAmount,uint256 spentAmount)',
]);
const KYBERSWAP_INTERFACE = new ethers.utils.Interface([
  'function swap((address,address,bytes,(address,address,address[],uint256[],address[],uint256[],address,uint256,uint256,uint256,bytes),bytes)) payable returns (uint256)',
]);
const PARASWAP_INTERFACE = new ethers.utils.Interface([
  'function swapExactAmountIn(address executor,(address srcToken,address destToken,uint256 fromAmount,uint256 toAmount,uint256 quotedAmount,bytes32 metadata,address beneficiary) swapData,uint256 partnerAndFee,bytes permit,bytes executorData) payable returns (uint256 receivedAmount,uint256 paraswapShare,uint256 partnerShare)',
]);
const MATCHA_INTERFACE = new ethers.utils.Interface([
  'function execute((address recipient,address buyToken,uint256 minAmountOut) slippage,bytes[] actions,bytes32 zidAndAffiliate) payable returns (bool)',
]);
const ZEROX_DEPLOYER_INTERFACE = new ethers.utils.Interface([
  'function ownerOf(uint256 tokenId) view returns (address)',
]);

export interface LlamaSwapToken {
  address: string;
  decimals: number;
  symbol?: string;
}

export interface LlamaSwapQuoteRequest {
  chainServerId: string;
  fromToken: LlamaSwapToken;
  toToken: LlamaSwapToken;
  amount: string;
  userAddress: string;
  slippage: string;
}

export interface LlamaSwapPermit2TypedData {
  hash: string;
  domain: {
    name: 'Permit2';
    chainId: number;
    verifyingContract: string;
  };
  types: {
    PermitTransferFrom: Array<{ name: string; type: string }>;
    EIP712Domain: Array<{ name: string; type: string }>;
    TokenPermissions: Array<{ name: string; type: string }>;
  };
  primaryType: 'PermitTransferFrom';
  message: {
    permitted: { token: string; amount: string };
    spender: string;
    nonce: string;
    deadline: string;
  };
}

export interface ValidatedLlamaSwapQuote {
  provider: LlamaSwapProtocol;
  quoteSource: 'LlamaSwap frontend API';
  chainServerId: string;
  fromToken: string;
  toToken: string;
  amountIn: string;
  amountOut: string;
  minimumAmountOut: string;
  slippage: string;
  approvalSpender: string;
  estimatedGas: string;
  transaction: {
    from: string;
    to: string;
    data: string;
    value: string;
    gas?: string;
  };
  permit2?: LlamaSwapPermit2TypedData;
  quoteId: string;
  expiresAt: number;
  providersCompared: LlamaSwapProtocol[];
  availableProviders: LlamaSwapProtocol[];
}

interface ValidationState {
  chainName: string;
  chainId: number;
  fromToken: string;
  toToken: string;
  userAddress: string;
  amountIn: string;
  amountOut: string;
  minimumAmountOut: string;
  slippage: string;
  rawQuote: any;
  estimatedGas: string;
}

const normalizeTokenAddress = (address: string) =>
  address.toLowerCase() === LLAMASWAP_NATIVE_TOKEN
    ? LLAMASWAP_NATIVE_TOKEN
    : ethers.utils.getAddress(address).toLowerCase();

const normalizeAddress = (address: unknown, label: string) => {
  try {
    return ethers.utils.getAddress(String(address)).toLowerCase();
  } catch {
    throw new Error(`LlamaSwap returned an invalid ${label}`);
  }
};

const assertIntegerString = (value: unknown, label: string) => {
  const stringValue = String(value ?? '');
  if (!/^\d+$/.test(stringValue) || BigInt(stringValue) <= 0n) {
    throw new Error(`Invalid LlamaSwap ${label}`);
  }
  return stringValue;
};

const assertNonnegativeIntegerString = (value: unknown, label: string) => {
  const stringValue = String(value ?? '');
  if (!/^\d+$/.test(stringValue)) {
    throw new Error(`Invalid LlamaSwap ${label}`);
  }
  return stringValue;
};

const assertHexData = (value: unknown) => {
  const data = String(value || '').toLowerCase();
  if (!/^0x(?:[0-9a-f]{2})+$/.test(data) || data.length < 10) {
    throw new Error('LlamaSwap returned invalid calldata');
  }
  if ((data.length - 2) / 2 > MAX_CALLDATA_BYTES) {
    throw new Error('LlamaSwap calldata exceeds the local safety cap');
  }
  return data;
};

const parseSlippageBps = (value: string) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) {
    throw new Error('LlamaSwap slippage must use at most two decimal places');
  }
  const [whole, fraction = ''] = value.split('.');
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(bps) || bps < 10 || bps > 1_000) {
    throw new Error('LlamaSwap slippage must be between 0.1% and 10%');
  }
  return bps;
};

const formatSlippageBps = (bps: number) =>
  `${Math.floor(bps / 100)}.${String(bps % 100).padStart(2, '0')}`;

const getProtocolSlippage = (
  requestedSlippage: string,
  protocol: LlamaSwapProtocol
) => {
  const bps = parseSlippageBps(requestedSlippage);
  // 0x can round its encoded minimum a fraction below the requested bound.
  // Request one basis point less so the on-chain minimum remains conservative.
  return protocol === 'Matcha/0x v2'
    ? formatSlippageBps(Math.max(1, bps - 1))
    : requestedSlippage;
};

const assertNoFeeValue = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === false) return;
  if (value === 0 || value === '0' || value === '0x0' || value === '0x') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoFeeValue(item, label));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((item) =>
      assertNoFeeValue(item, label)
    );
    return;
  }
  throw new Error(`LlamaSwap returned an unexpected ${label}`);
};

const buildValidationState = (
  request: LlamaSwapQuoteRequest,
  response: any
): ValidationState => {
  const chainName = LLAMASWAP_CHAIN_BY_SERVER_ID[request.chainServerId];
  const chain = findChain({ serverId: request.chainServerId });
  if (!chainName || !chain) {
    throw new Error('LlamaSwap does not support this chain');
  }
  const fromToken = normalizeTokenAddress(request.fromToken.address);
  const toToken = normalizeTokenAddress(request.toToken.address);
  if (fromToken === toToken) throw new Error('Swap tokens must be different');

  const userAddress = normalizeAddress(request.userAddress, 'user address');
  const amountIn = assertIntegerString(request.amount, 'input amount');
  const slippageBps = parseSlippageBps(request.slippage);
  const amountOut = assertIntegerString(
    response?.amountReturned,
    'output amount'
  );
  const minimumAmountOut = (
    (BigInt(amountOut) * BigInt(10_000 - slippageBps)) /
    10_000n
  ).toString();
  const rawQuote = response?.rawQuote;
  if (!rawQuote || typeof rawQuote !== 'object') {
    throw new Error('LlamaSwap response is missing the raw quote');
  }
  const estimatedGas = assertIntegerString(
    response?.estimatedGas ?? rawQuote.gas ?? rawQuote.gasLimit,
    'gas data'
  );
  if (BigInt(estimatedGas) > MAX_SWAP_GAS) {
    throw new Error('LlamaSwap gas estimate exceeds the local safety cap');
  }

  return {
    chainName,
    chainId: chain.id,
    fromToken,
    toToken,
    userAddress,
    amountIn,
    amountOut,
    minimumAmountOut,
    slippage: String(Number(request.slippage)),
    rawQuote,
    estimatedGas,
  };
};

const assertTransactionValue = (state: ValidationState, value: unknown) => {
  const normalized = assertNonnegativeIntegerString(
    value ?? '0',
    'transaction value'
  );
  const expected =
    state.fromToken === LLAMASWAP_NATIVE_TOKEN ? state.amountIn : '0';
  if (BigInt(normalized) !== BigInt(expected)) {
    throw new Error('LlamaSwap native value mismatch');
  }
  return normalized;
};

const buildQuote = ({
  request,
  state,
  protocol,
  router,
  spender,
  data,
  value,
  permit2,
}: {
  request: LlamaSwapQuoteRequest;
  state: ValidationState;
  protocol: LlamaSwapProtocol;
  router: string;
  spender: string;
  data: string;
  value: string;
  permit2?: LlamaSwapPermit2TypedData;
}): ValidatedLlamaSwapQuote => {
  const quoteMaterial = JSON.stringify({
    protocol,
    chain: state.chainName,
    chainId: state.chainId,
    fromToken: state.fromToken,
    toToken: state.toToken,
    amountIn: state.amountIn,
    amountOut: state.amountOut,
    minimumAmountOut: state.minimumAmountOut,
    userAddress: state.userAddress,
    router,
    spender,
    data,
    value,
    permit2Hash: permit2?.hash || null,
  });

  return {
    provider: protocol,
    quoteSource: 'LlamaSwap frontend API',
    chainServerId: request.chainServerId,
    fromToken: state.fromToken,
    toToken: state.toToken,
    amountIn: state.amountIn,
    amountOut: state.amountOut,
    minimumAmountOut: state.minimumAmountOut,
    slippage: state.slippage,
    approvalSpender: spender,
    estimatedGas: state.estimatedGas,
    transaction: {
      from: state.userAddress,
      to: router,
      data,
      value,
      gas: `0x${BigInt(state.estimatedGas).toString(16)}`,
    },
    permit2,
    quoteId: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(quoteMaterial)),
    expiresAt: Date.now() + QUOTE_LIFETIME_MS,
    providersCompared: [],
    availableProviders: [],
  };
};

const validateOneInch = (
  request: LlamaSwapQuoteRequest,
  state: ValidationState,
  response: any
) => {
  const raw = state.rawQuote;
  const tx = raw.tx;
  if (!tx || typeof tx !== 'object') {
    throw new Error('LlamaSwap response is missing the 1inch transaction');
  }
  if (String(raw.dstAmount) !== state.amountOut) {
    throw new Error('LlamaSwap output amount mismatch');
  }
  const router = normalizeAddress(tx.to, '1inch router');
  const spender = normalizeAddress(
    response.tokenApprovalAddress,
    '1inch spender'
  );
  if (router !== ONEINCH_ROUTER || spender !== ONEINCH_ROUTER) {
    throw new Error('LlamaSwap returned an unapproved 1inch router or spender');
  }
  if (normalizeAddress(tx.from, '1inch sender') !== state.userAddress) {
    throw new Error('1inch sender does not match the reviewed quote');
  }
  const data = assertHexData(tx.data);
  try {
    const decoded = ONEINCH_INTERFACE.decodeFunctionData('swap', data);
    const executor = normalizeAddress(decoded.executor, '1inch executor');
    const desc = decoded.desc;
    if (
      normalizeTokenAddress(desc.srcToken) !== state.fromToken ||
      normalizeTokenAddress(desc.dstToken) !== state.toToken ||
      normalizeAddress(desc.srcReceiver, '1inch source receiver') !==
        executor ||
      normalizeAddress(desc.dstReceiver, '1inch recipient') !==
        state.userAddress ||
      BigInt(desc.amount.toString()) !== BigInt(state.amountIn) ||
      BigInt(desc.minReturnAmount.toString()) <
        BigInt(state.minimumAmountOut) ||
      !desc.flags.isZero()
    ) {
      throw new Error('1inch calldata does not match the reviewed quote');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('reviewed quote')) {
      throw error;
    }
    throw new Error('LlamaSwap returned undecodable 1inch calldata');
  }
  const value = assertTransactionValue(state, tx.value);
  return buildQuote({
    request,
    state,
    protocol: '1inch',
    router,
    spender,
    data,
    value,
  });
};

const validateKyberSwap = (
  request: LlamaSwapQuoteRequest,
  state: ValidationState,
  response: any
) => {
  const raw = state.rawQuote;
  if (
    String(raw.amountIn) !== state.amountIn ||
    String(raw.amountOut) !== state.amountOut
  ) {
    throw new Error('LlamaSwap KyberSwap amount mismatch');
  }
  const router = normalizeAddress(raw.routerAddress, 'KyberSwap router');
  const spender = normalizeAddress(
    response.tokenApprovalAddress,
    'KyberSwap spender'
  );
  if (router !== KYBERSWAP_ROUTER || spender !== KYBERSWAP_ROUTER) {
    throw new Error(
      'LlamaSwap returned an unapproved KyberSwap router or spender'
    );
  }
  const data = assertHexData(raw.data);
  try {
    const execution = KYBERSWAP_INTERFACE.decodeFunctionData('swap', data)[0];
    const description = execution[3];
    if (
      normalizeTokenAddress(description[0]) !== state.fromToken ||
      normalizeTokenAddress(description[1]) !== state.toToken ||
      normalizeAddress(description[6], 'KyberSwap recipient') !==
        state.userAddress ||
      BigInt(description[7].toString()) !== BigInt(state.amountIn) ||
      BigInt(description[8].toString()) < BigInt(state.minimumAmountOut)
    ) {
      throw new Error('KyberSwap calldata does not match the reviewed quote');
    }
    const feeAmounts = description[5] as ethers.BigNumber[];
    if (feeAmounts.some((amount) => !amount.isZero())) {
      throw new Error('KyberSwap calldata contains an unexpected fee');
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('reviewed quote') ||
        error.message.includes('unexpected fee'))
    ) {
      throw error;
    }
    throw new Error('LlamaSwap returned undecodable KyberSwap calldata');
  }
  assertNoFeeValue(raw.additionalCostUsd, 'KyberSwap additional fee');
  const value = assertTransactionValue(state, raw.transactionValue);
  return buildQuote({
    request,
    state,
    protocol: 'KyberSwap',
    router,
    spender,
    data,
    value,
  });
};

const validateParaSwap = (
  request: LlamaSwapQuoteRequest,
  state: ValidationState,
  response: any
) => {
  const raw = state.rawQuote;
  if (String(response.amountIn) !== state.amountIn) {
    throw new Error('LlamaSwap ParaSwap input amount mismatch');
  }
  const router = normalizeAddress(raw.to, 'ParaSwap router');
  const spender = normalizeAddress(
    response.tokenApprovalAddress,
    'ParaSwap spender'
  );
  if (router !== PARASWAP_ROUTER || spender !== PARASWAP_ROUTER) {
    throw new Error(
      'LlamaSwap returned an unapproved ParaSwap router or spender'
    );
  }
  if (
    raw.tokenApprovalAddress &&
    normalizeAddress(raw.tokenApprovalAddress, 'ParaSwap approval target') !==
      PARASWAP_ROUTER
  ) {
    throw new Error(
      'LlamaSwap returned an unapproved ParaSwap approval target'
    );
  }
  if (normalizeAddress(raw.from, 'ParaSwap sender') !== state.userAddress) {
    throw new Error('ParaSwap sender does not match the reviewed quote');
  }
  if (Number(raw.chainId) !== state.chainId) {
    throw new Error('ParaSwap chain does not match the reviewed quote');
  }
  const data = assertHexData(raw.data);
  try {
    const decoded = PARASWAP_INTERFACE.decodeFunctionData(
      'swapExactAmountIn',
      data
    );
    const swapData = decoded.swapData;
    const beneficiary = normalizeAddress(
      swapData.beneficiary,
      'ParaSwap beneficiary'
    );
    if (
      normalizeTokenAddress(swapData.srcToken) !== state.fromToken ||
      normalizeTokenAddress(swapData.destToken) !== state.toToken ||
      BigInt(swapData.fromAmount.toString()) !== BigInt(state.amountIn) ||
      BigInt(swapData.toAmount.toString()) < BigInt(state.minimumAmountOut) ||
      BigInt(swapData.quotedAmount.toString()) !== BigInt(state.amountOut) ||
      ![ethers.constants.AddressZero, state.userAddress].includes(
        beneficiary
      ) ||
      decoded.permit !== '0x'
    ) {
      throw new Error('ParaSwap calldata does not match the reviewed quote');
    }
    const packed = ethers.utils.hexZeroPad(
      decoded.partnerAndFee.toHexString(),
      32
    );
    const partner = `0x${packed.slice(2, 42)}`.toLowerCase();
    const feeData = BigInt(`0x${packed.slice(42)}`);
    if (partner !== PARASWAP_LLAMASWAP_PARTNER || feeData !== 0n) {
      throw new Error('ParaSwap calldata contains an unexpected partner fee');
    }
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('reviewed quote') ||
        error.message.includes('unexpected partner fee'))
    ) {
      throw error;
    }
    throw new Error('LlamaSwap returned undecodable ParaSwap calldata');
  }
  const value = assertTransactionValue(state, raw.value);
  return buildQuote({
    request,
    state,
    protocol: 'ParaSwap',
    router,
    spender,
    data,
    value,
  });
};

const assertTypedDataField = (
  fields: unknown,
  expected: Array<{ name: string; type: string }>,
  label: string
) => {
  if (JSON.stringify(fields) !== JSON.stringify(expected)) {
    throw new Error(`Matcha returned an unexpected ${label} schema`);
  }
};

const validateMatchaPermit = (
  state: ValidationState,
  raw: any,
  response: any,
  router: string
): LlamaSwapPermit2TypedData | undefined => {
  const permit = raw.permit2;
  if (state.fromToken === LLAMASWAP_NATIVE_TOKEN) {
    if (permit != null || response.isSignatureNeededForSwap === true) {
      throw new Error('Matcha returned an unexpected native-token permit');
    }
    return undefined;
  }
  if (
    response.isSignatureNeededForSwap !== true ||
    permit?.type !== 'Permit2' ||
    !permit.eip712
  ) {
    throw new Error('Matcha response is missing its Permit2 authorization');
  }
  const typed = permit.eip712;
  const permitFields = [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ];
  const domainFields = [
    { name: 'name', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ];
  const tokenFields = [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ];
  assertTypedDataField(typed.types?.PermitTransferFrom, permitFields, 'permit');
  assertTypedDataField(typed.types?.EIP712Domain, domainFields, 'domain');
  assertTypedDataField(typed.types?.TokenPermissions, tokenFields, 'token');

  const domain = {
    name: typed.domain?.name,
    chainId: Number(typed.domain?.chainId),
    verifyingContract: normalizeAddress(
      typed.domain?.verifyingContract,
      'Permit2 contract'
    ),
  };
  const message = typed.message;
  const nonce = assertNonnegativeIntegerString(message?.nonce, 'Permit2 nonce');
  const deadline = assertIntegerString(message?.deadline, 'Permit2 deadline');
  const now = Math.floor(Date.now() / 1_000);
  if (
    domain.name !== 'Permit2' ||
    domain.chainId !== state.chainId ||
    domain.verifyingContract !== PERMIT2_ADDRESS ||
    typed.primaryType !== 'PermitTransferFrom' ||
    normalizeTokenAddress(message?.permitted?.token) !== state.fromToken ||
    String(message?.permitted?.amount) !== state.amountIn ||
    normalizeAddress(message?.spender, 'Permit2 spender') !== router ||
    BigInt(deadline) <= BigInt(now) ||
    BigInt(deadline) > BigInt(now + MATCHA_PERMIT_MAX_LIFETIME_SECONDS)
  ) {
    throw new Error('Matcha Permit2 data does not match the reviewed quote');
  }

  const types = {
    PermitTransferFrom: permitFields,
    EIP712Domain: domainFields,
    TokenPermissions: tokenFields,
  };
  const sanitizedMessage = {
    permitted: {
      token: state.fromToken,
      amount: state.amountIn,
    },
    spender: router,
    nonce,
    deadline,
  };
  const hash = ethers.utils._TypedDataEncoder.hash(
    domain,
    {
      PermitTransferFrom: permitFields,
      TokenPermissions: tokenFields,
    },
    sanitizedMessage
  );
  if (String(permit.hash).toLowerCase() !== hash.toLowerCase()) {
    throw new Error('Matcha Permit2 hash does not match its typed data');
  }
  return {
    hash,
    domain: {
      name: 'Permit2',
      chainId: domain.chainId,
      verifyingContract: domain.verifyingContract,
    },
    types,
    primaryType: 'PermitTransferFrom',
    message: sanitizedMessage,
  };
};

const validateMatcha = (
  request: LlamaSwapQuoteRequest,
  state: ValidationState,
  response: any,
  verifiedRouter?: string
) => {
  const raw = state.rawQuote;
  if (!verifiedRouter) {
    throw new Error('Could not verify the current Matcha Settler deployment');
  }
  const tx = raw.transaction;
  if (!tx || typeof tx !== 'object') {
    throw new Error('LlamaSwap response is missing the Matcha transaction');
  }
  const router = normalizeAddress(tx.to, 'Matcha Settler');
  if (router !== verifiedRouter) {
    throw new Error('Matcha transaction target is not the active 0x Settler');
  }
  const spender = normalizeAddress(
    response.tokenApprovalAddress,
    'Matcha spender'
  );
  if (
    spender !== PERMIT2_ADDRESS ||
    normalizeAddress(raw.allowanceTarget, 'Matcha allowance target') !==
      PERMIT2_ADDRESS
  ) {
    throw new Error('LlamaSwap returned an unapproved Matcha spender');
  }
  if (
    raw.liquidityAvailable !== true ||
    String(response.amountIn) !== state.amountIn ||
    String(raw.sellAmount) !== state.amountIn ||
    String(raw.buyAmount) !== state.amountOut ||
    normalizeTokenAddress(raw.sellToken) !== state.fromToken ||
    normalizeTokenAddress(raw.buyToken) !== state.toToken ||
    BigInt(assertIntegerString(raw.minBuyAmount, 'Matcha minimum output')) <
      BigInt(state.minimumAmountOut)
  ) {
    throw new Error('Matcha response does not match the reviewed quote');
  }
  assertNoFeeValue(raw.fees, 'Matcha fee');

  const data = assertHexData(tx.data);
  if (data.slice(0, 10) !== MATCHA_INTERFACE.getSighash('execute')) {
    throw new Error('Matcha returned an unsupported transaction entry point');
  }
  if (ethers.utils.hexDataLength(data) < 4 + 32 * 5) {
    throw new Error('Matcha returned truncated calldata');
  }
  const head = ethers.utils.hexDataSlice(data, 4, 4 + 32 * 5);
  const [
    recipient,
    buyToken,
    minAmountOut,
    actionsOffset,
    zidAndAffiliate,
  ] = ethers.utils.defaultAbiCoder.decode(
    ['address', 'address', 'uint256', 'uint256', 'bytes32'],
    head
  );
  const rawZid = String(raw.zid || '').toLowerCase();
  const expectedZid = /^0x[0-9a-f]{24}$/.test(rawZid)
    ? `${rawZid}${ZEROX_LLAMASWAP_AFFILIATE.slice(2)}`
    : '';
  if (
    normalizeAddress(recipient, 'Matcha recipient') !== state.userAddress ||
    normalizeTokenAddress(buyToken) !== state.toToken ||
    BigInt(minAmountOut.toString()) < BigInt(state.minimumAmountOut) ||
    BigInt(actionsOffset.toString()) !== 160n ||
    String(zidAndAffiliate).toLowerCase() !== expectedZid
  ) {
    throw new Error('Matcha calldata does not match the reviewed quote');
  }

  const value = assertTransactionValue(state, tx.value);
  const permit2 = validateMatchaPermit(state, raw, response, router);
  return buildQuote({
    request,
    state,
    protocol: 'Matcha/0x v2',
    router,
    spender,
    data,
    value,
    permit2,
  });
};

export const validateLlamaSwapQuote = (
  request: LlamaSwapQuoteRequest,
  response: any,
  protocol: LlamaSwapProtocol,
  verifiedMatchaRouter?: string
): ValidatedLlamaSwapQuote => {
  const state = buildValidationState(request, response);
  switch (protocol) {
    case '1inch':
      return validateOneInch(request, state, response);
    case 'KyberSwap':
      return validateKyberSwap(request, state, response);
    case 'ParaSwap':
      return validateParaSwap(request, state, response);
    case 'Matcha/0x v2':
      return validateMatcha(request, state, response, verifiedMatchaRouter);
    default:
      throw new Error('Unsupported LlamaSwap protocol');
  }
};

export class LlamaSwapService {
  private requestRPC = async (
    chainServerId: string,
    method: string,
    params: any[]
  ) => {
    const chain = findChain({ serverId: chainServerId });
    if (!chain) throw new Error('Unknown chain');
    if (RPCService.hasCustomRPC(chain.enum)) {
      return RPCService.requestCustomRPC(chain.enum, method, params);
    }
    return RPCService.requestDefaultRPC({
      chainServerId,
      method,
      params,
    });
  };

  private getCurrentMatchaRouter = async (chainServerId: string) => {
    const result = await this.requestRPC(chainServerId, 'eth_call', [
      {
        to: ZEROX_SETTLER_DEPLOYER,
        data: ZEROX_DEPLOYER_INTERFACE.encodeFunctionData('ownerOf', [
          ZEROX_TAKER_SUBMITTED_FEATURE,
        ]),
      },
      'latest',
    ]);
    return normalizeAddress(
      ZEROX_DEPLOYER_INTERFACE.decodeFunctionResult('ownerOf', result)[0],
      'active 0x Settler'
    );
  };

  private fetchProtocolQuote = async (
    request: LlamaSwapQuoteRequest,
    protocol: LlamaSwapProtocol
  ) => {
    const chain = LLAMASWAP_CHAIN_BY_SERVER_ID[request.chainServerId];
    if (!chain) throw new Error('LlamaSwap does not support this chain');
    const from = normalizeTokenAddress(request.fromToken.address);
    const to = normalizeTokenAddress(request.toToken.address);
    const params = new URLSearchParams({
      protocol,
      chain,
      from,
      to,
      amount: request.amount,
      api_key: LLAMASWAP_PUBLIC_FRONTEND_KEY,
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${LLAMASWAP_QUOTE_ENDPOINT}?${params}`, {
        method: 'POST',
        body: JSON.stringify({
          userAddress: request.userAddress,
          slippage: getProtocolSlippage(request.slippage, protocol),
          isPrivacyEnabled: true,
          fromToken: {
            address: from,
            decimals: request.fromToken.decimals,
          },
          toToken: {
            address: to,
            decimals: request.toToken.decimals,
          },
        }),
        credentials: 'include',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`${protocol} quote failed (${response.status})`);
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (
        Number.isFinite(declaredLength) &&
        declaredLength > MAX_RESPONSE_CHARACTERS
      ) {
        throw new Error(`${protocol} quote response is too large`);
      }
      const text = await response.text();
      if (text.length > MAX_RESPONSE_CHARACTERS) {
        throw new Error(`${protocol} quote response is too large`);
      }
      try {
        return JSON.parse(text);
      } catch (_error) {
        throw new Error(`${protocol} quote returned invalid JSON`);
      }
    } finally {
      clearTimeout(timeout);
    }
  };

  getTokenMetadata = async ({
    chainServerId,
    tokenAddress,
    ownerAddress,
  }: {
    chainServerId: string;
    tokenAddress: string;
    ownerAddress: string;
  }) => {
    const chain = findChain({ serverId: chainServerId });
    if (!chain) throw new Error('Unknown chain');
    const owner = ethers.utils.getAddress(ownerAddress);
    if (tokenAddress.toLowerCase() === LLAMASWAP_NATIVE_TOKEN) {
      return {
        address: LLAMASWAP_NATIVE_TOKEN,
        decimals: 18,
        symbol: chain.nativeTokenSymbol,
        balance: await this.requestRPC(chainServerId, 'eth_getBalance', [
          owner,
          'latest',
        ]),
      };
    }

    const token = ethers.utils.getAddress(tokenAddress);
    const balanceData = `0x70a08231${owner
      .toLowerCase()
      .slice(2)
      .padStart(64, '0')}`;
    const [decimalsRaw, symbolRaw, balanceRaw] = await Promise.all([
      this.requestRPC(chainServerId, 'eth_call', [
        { to: token, data: '0x313ce567' },
        'latest',
      ]),
      this.requestRPC(chainServerId, 'eth_call', [
        { to: token, data: '0x95d89b41' },
        'latest',
      ]).catch(() => '0x'),
      this.requestRPC(chainServerId, 'eth_call', [
        { to: token, data: balanceData },
        'latest',
      ]),
    ]);
    const decimals = Number(BigInt(decimalsRaw));
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new Error('Token returned invalid decimals');
    }
    let symbol = 'TOKEN';
    try {
      symbol = ethers.utils.defaultAbiCoder.decode(['string'], symbolRaw)[0];
    } catch {
      try {
        symbol =
          ethers.utils.toUtf8String(symbolRaw).replace(/\0+$/g, '') || symbol;
      } catch {
        // Keep the local fallback label.
      }
    }
    return {
      address: token.toLowerCase(),
      decimals,
      symbol: String(symbol).slice(0, 32),
      balance: balanceRaw,
    };
  };

  getQuotes = async (
    request: LlamaSwapQuoteRequest
  ): Promise<ValidatedLlamaSwapQuote[]> => {
    const protocols = LLAMASWAP_PROTOCOLS_BY_CHAIN[request.chainServerId];
    if (!protocols?.length) {
      throw new Error('LlamaSwap does not support this chain');
    }

    const matchaRouterPromise = protocols.includes('Matcha/0x v2')
      ? this.getCurrentMatchaRouter(request.chainServerId).catch(
          () => undefined
        )
      : Promise.resolve(undefined);
    const settled = await Promise.allSettled(
      protocols.map(async (protocol) => {
        const [response, matchaRouter] = await Promise.all([
          this.fetchProtocolQuote(request, protocol),
          protocol === 'Matcha/0x v2'
            ? matchaRouterPromise
            : Promise.resolve(undefined),
        ]);
        return validateLlamaSwapQuote(
          request,
          response,
          protocol,
          matchaRouter
        );
      })
    );

    const quotes = settled
      .filter(
        (result): result is PromiseFulfilledResult<ValidatedLlamaSwapQuote> =>
          result.status === 'fulfilled'
      )
      .map((result) => result.value)
      .sort((a, b) => {
        const outputDifference = BigInt(b.amountOut) - BigInt(a.amountOut);
        if (outputDifference !== 0n) return outputDifference > 0n ? 1 : -1;
        return BigInt(a.estimatedGas) < BigInt(b.estimatedGas) ? -1 : 1;
      });

    if (!quotes.length) {
      const reasons = settled
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === 'rejected'
        )
        .map((result) =>
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
        );
      throw new Error(`No valid LlamaSwap routes: ${reasons.join('; ')}`);
    }

    const availableProviders = quotes.map((quote) => quote.provider);
    return quotes.map((quote) => ({
      ...quote,
      providersCompared: [...protocols],
      availableProviders,
    }));
  };

  getQuote = async (
    request: LlamaSwapQuoteRequest
  ): Promise<ValidatedLlamaSwapQuote> => (await this.getQuotes(request))[0];
}

export default new LlamaSwapService();
