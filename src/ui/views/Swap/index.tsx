import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, Button, Input, Modal, Select, message } from 'antd';
import { ethers } from 'ethers';
import { useLocation } from 'react-router-dom';
import type { TokenItem } from '@/background/service/openapi';
import { useCurrentAccount } from '@/ui/hooks/backgroundState/useAccount';
import { usePopupContainer } from '@/ui/hooks/usePopupContainer';
import { useWallet } from '@/ui/utils';
import TokenWithChain from '@/ui/component/TokenWithChain';
import { ReactComponent as RcIconArrowDown } from '@/ui/assets/swap/arrow-caret-down2.svg';
import { ReactComponent as RcIconSwitch } from '@/ui/assets/swap/switch-cc.svg';
import { findChain } from '@/utils/chain';
import {
  COW_SWAP_CHAIN_CONFIG_BY_ID,
  COW_SWAP_NATIVE_TOKEN,
  COW_SWAP_SUPPORTED_CHAIN_IDS,
} from '@/constant/cow-swap';
import type {
  CowSwapOrderStatus,
  CowSwapTokenMetadata,
  ValidatedCowSwapQuote,
} from '@/background/service/cowSwap';
import CowTokenSelector from './CowTokenSelector';
import {
  cowSwapMetadataToTokenItem,
  getCowSwapRouteTokenAddress,
  getCowSwapStandardTokens,
  getCowSwapTokenAddress,
  isRiskyCowSwapToken,
} from './cowSwapTokens';
import {
  getCowSwapTransactionReceipt,
  sendCowSwapTransaction,
  signCowSwapTypedData,
} from './cowSwapWallet';
import { isReviewedCowSwapQuoteExecutable } from './cowSwapSafety';

const HISTORY_KEY = 'hippoLocalCowSwapHistory';
const HISTORY_LIMIT = 100;
const RECEIPT_TIMEOUT_MS = 3 * 60 * 1000;

interface LocalCowSwapOrder {
  orderUid: string;
  ownerAddress: string;
  chainServerId: string;
  chainId: number;
  fromToken: string;
  toToken: string;
  fromSymbol: string;
  toSymbol: string;
  fromDecimals: number;
  toDecimals: number;
  amountIn: string;
  amountOut: string;
  minimumAmountOut: string;
  nativeSell: boolean;
  creationTxHash?: string;
  cancellationTxHash?: string;
  status:
    | 'creating'
    | 'notFound'
    | 'presignaturePending'
    | 'open'
    | 'fulfilled'
    | 'cancelled'
    | 'expired'
    | 'refunded'
    | 'failed';
  explorerUrl: string;
  createdAt: number;
  updatedAt: number;
}

const formatTokenAmount = (amount: string, decimals: number) => {
  try {
    const value = ethers.utils.formatUnits(amount, decimals);
    const [whole, fraction = ''] = value.split('.');
    const trimmed = fraction.slice(0, 8).replace(/0+$/, '');
    return trimmed ? `${whole}.${trimmed}` : whole;
  } catch {
    return amount;
  }
};

const shortHash = (value: string) =>
  value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;

const withoutDomainType = (
  types: Record<string, Array<{ name: string; type: string }>>
) => {
  const { EIP712Domain: _domainType, ...messageTypes } = types;
  return messageTypes;
};

const getTrustedExplorerUrl = (order: LocalCowSwapOrder) => {
  if (!/^0x[0-9a-f]{112}$/.test(order.orderUid)) return null;
  const chain = findChain({ serverId: order.chainServerId });
  const config = chain
    ? COW_SWAP_CHAIN_CONFIG_BY_ID[Number(chain.id)]
    : undefined;
  return config ? `${config.explorerBaseUrl}/orders/${order.orderUid}` : null;
};

const readHistory = (): LocalCowSwapOrder[] => {
  // The retired aggregator used this separate key. Remove its residual local
  // order metadata during the first CoW history read.
  localStorage.removeItem('hippoLocalSwapHistory');
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof item.orderUid === 'string' &&
        /^0x[0-9a-f]{112}$/.test(item.orderUid) &&
        typeof item.ownerAddress === 'string' &&
        ethers.utils.isAddress(item.ownerAddress) &&
        typeof item.chainServerId === 'string' &&
        Boolean(
          COW_SWAP_CHAIN_CONFIG_BY_ID[
            Number(findChain({ serverId: item.chainServerId })?.id)
          ]
        ) &&
        typeof item.createdAt === 'number'
    );
  } catch {
    return [];
  }
};

const writeHistory = (orders: LocalCowSwapOrder[]) => {
  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify(orders.slice(0, HISTORY_LIMIT))
  );
};

const SwapTokenButton = ({
  token,
  loading,
  onClick,
}: {
  token: TokenItem | null;
  loading: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    className="flex h-[40px] max-w-[155px] items-center gap-8 rounded-[20px] border-0 bg-r-neutral-card-1 px-10 text-r-neutral-title-1 shadow-sm"
    onClick={onClick}
  >
    {token ? (
      <>
        <TokenWithChain
          token={token}
          width="26px"
          height="26px"
          hideConer
          hideChainIcon
        />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">
          {token.display_symbol || token.symbol}
        </span>
      </>
    ) : (
      <span className="text-[13px] font-medium">
        {loading ? 'Loading...' : 'Select token'}
      </span>
    )}
    <RcIconArrowDown className="h-10 w-10 shrink-0 text-r-neutral-foot" />
  </button>
);

const Swap = () => {
  const wallet = useWallet();
  const account = useCurrentAccount();
  const { getContainer } = usePopupContainer();
  const location = useLocation();
  const chainOptions = useMemo(
    () =>
      COW_SWAP_SUPPORTED_CHAIN_IDS.map((chainId) => findChain({ id: chainId }))
        .filter(Boolean)
        .map((chain) => ({
          label: chain!.name,
          value: chain!.serverId,
          chainId: Number(chain!.id),
        })),
    []
  );
  const routeParams = new URLSearchParams(location.search);
  const routeChainServerId = routeParams.get('chain');
  const requestedChain = routeChainServerId
    ? chainOptions.find((item) => item.value === routeChainServerId)
    : undefined;
  const unsupportedRouteChain = routeParams.has('chain') && !requestedChain;
  const initialChain = requestedChain || chainOptions[0];
  const initialChainServerId = initialChain?.value || 'eth';
  const initialChainConfig = COW_SWAP_CHAIN_CONFIG_BY_ID[initialChain?.chainId];
  const routeFromAddress = getCowSwapRouteTokenAddress(
    routeParams.get('payTokenId'),
    initialChainServerId
  );
  const invalidRouteToken = routeParams.has('payTokenId') && !routeFromAddress;
  const routeError = unsupportedRouteChain
    ? `CoW Swap does not support the requested chain: ${routeChainServerId}`
    : invalidRouteToken
    ? 'The requested sell token is not a valid contract on this chain.'
    : null;
  const initialFromAddress = routeFromAddress || COW_SWAP_NATIVE_TOKEN;
  const initialStandardTokens = getCowSwapStandardTokens(initialChainServerId);
  const initialFromTokenItem = initialStandardTokens.find((token) => {
    try {
      return (
        getCowSwapTokenAddress(token, initialChainServerId) ===
        initialFromAddress
      );
    } catch {
      return false;
    }
  });
  const defaultInitialToAddress = initialChainConfig?.defaultOutputToken || '';
  const initialToAddress =
    initialFromAddress === defaultInitialToAddress
      ? COW_SWAP_NATIVE_TOKEN
      : defaultInitialToAddress;
  const initialToTokenItem = initialStandardTokens.find((token) => {
    try {
      return (
        getCowSwapTokenAddress(token, initialChainServerId) === initialToAddress
      );
    } catch {
      return false;
    }
  });
  const [chainServerId, setChainServerId] = useState(initialChainServerId);
  const selectedChain = useMemo(() => findChain({ serverId: chainServerId }), [
    chainServerId,
  ]);
  const [fromAddress, setFromAddress] = useState(initialFromAddress);
  const [toAddress, setToAddress] = useState(initialToAddress);
  const [fromTokenItem, setFromTokenItem] = useState<TokenItem | null>(
    initialFromTokenItem || null
  );
  const [toTokenItem, setToTokenItem] = useState<TokenItem | null>(
    initialToTokenItem || null
  );
  const [fromToken, setFromToken] = useState<CowSwapTokenMetadata | null>(null);
  const [toToken, setToToken] = useState<CowSwapTokenMetadata | null>(null);
  const [tokenSelectorMode, setTokenSelectorMode] = useState<
    'sell' | 'buy' | null
  >(null);
  const [confirmedRiskTokenKeys, setConfirmedRiskTokenKeys] = useState<
    string[]
  >([]);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [quote, setQuote] = useState<ValidatedCowSwapQuote | null>(null);
  const [allowance, setAllowance] = useState('0');
  const [history, setHistory] = useState<LocalCowSwapOrder[]>([]);
  const historyRef = useRef<LocalCowSwapOrder[]>([]);
  const inputGenerationRef = useRef(0);
  const tokenLoadGenerationRef = useRef(0);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cancellingUid, setCancellingUid] = useState<string | null>(null);
  const activeAccountRef = useRef(account?.address?.toLowerCase());
  const activeChainRef = useRef(chainServerId);
  activeAccountRef.current = account?.address?.toLowerCase();
  activeChainRef.current = chainServerId;

  const assertActiveContext = (
    expectedOwner: string,
    expectedChainServerId: string
  ) => {
    if (
      activeAccountRef.current !== expectedOwner.toLowerCase() ||
      activeChainRef.current !== expectedChainServerId
    ) {
      throw new Error('Account or chain changed; review the CoW order again');
    }
  };

  useEffect(() => {
    const owner = account?.address?.toLowerCase();
    inputGenerationRef.current += 1;
    setAmount('');
    setQuote(null);
    setAllowance('0');
    setQuoting(false);
    setHistory(
      readHistory().filter((item) => item.ownerAddress.toLowerCase() === owner)
    );
  }, [account?.address]);

  useEffect(() => {
    inputGenerationRef.current += 1;
    setQuote(null);
    setAllowance('0');
    setFromToken(null);
    setToToken(null);
    const generation = ++tokenLoadGenerationRef.current;
    if (!account || !selectedChain || !fromAddress || !toAddress) {
      setLoadingTokens(false);
      return;
    }
    if (fromAddress === toAddress) {
      setLoadingTokens(false);
      return;
    }

    const expectedOwner = account.address.toLowerCase();
    const expectedChainServerId = chainServerId;
    setLoadingTokens(true);
    void Promise.all([
      wallet.getCowSwapTokenMetadata({
        chainServerId,
        tokenAddress: fromAddress,
        ownerAddress: account.address,
      }),
      wallet.getCowSwapTokenMetadata({
        chainServerId,
        tokenAddress: toAddress,
        ownerAddress: account.address,
      }),
    ])
      .then(([sell, buy]) => {
        if (
          tokenLoadGenerationRef.current !== generation ||
          activeAccountRef.current !== expectedOwner ||
          activeChainRef.current !== expectedChainServerId
        ) {
          return;
        }
        if (sell.address.toLowerCase() === buy.address.toLowerCase()) {
          throw new Error('Sell and buy tokens must differ');
        }
        setFromToken(sell);
        setToToken(buy);
        setFromTokenItem((current) =>
          cowSwapMetadataToTokenItem(sell, chainServerId, current || undefined)
        );
        setToTokenItem((current) =>
          cowSwapMetadataToTokenItem(buy, chainServerId, current || undefined)
        );
      })
      .catch((error: any) => {
        if (tokenLoadGenerationRef.current !== generation) return;
        setFromToken(null);
        setToToken(null);
        message.error(error?.message || 'Unable to read token metadata');
      })
      .finally(() => {
        if (tokenLoadGenerationRef.current === generation) {
          setLoadingTokens(false);
        }
      });
  }, [
    account?.address,
    chainServerId,
    fromAddress,
    selectedChain,
    toAddress,
    wallet,
  ]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  const persistHistory = useCallback(
    (update: (current: LocalCowSwapOrder[]) => LocalCowSwapOrder[]) => {
      setHistory((current) => {
        const next = update(current);
        const all = readHistory().filter(
          (item) =>
            item.ownerAddress.toLowerCase() !== account?.address?.toLowerCase()
        );
        writeHistory([...next, ...all]);
        return next;
      });
    },
    [account?.address]
  );

  const resetQuote = () => {
    inputGenerationRef.current += 1;
    setQuote(null);
    setAllowance('0');
    setQuoting(false);
  };

  const onChainChange = (nextServerId: string) => {
    const nextChain = findChain({ serverId: nextServerId });
    const config = nextChain
      ? COW_SWAP_CHAIN_CONFIG_BY_ID[Number(nextChain.id)]
      : undefined;
    const standardTokens = getCowSwapStandardTokens(nextServerId);
    setChainServerId(nextServerId);
    setFromAddress(COW_SWAP_NATIVE_TOKEN);
    setToAddress(config?.defaultOutputToken || '');
    setFromTokenItem(standardTokens[0] || null);
    setToTokenItem(
      standardTokens.find((token) => {
        try {
          return (
            getCowSwapTokenAddress(token, nextServerId) ===
            config?.defaultOutputToken
          );
        } catch {
          return false;
        }
      }) || null
    );
    setFromToken(null);
    setToToken(null);
    setAmount('');
    resetQuote();
  };

  const getRiskTokenKey = (token: TokenItem) => {
    try {
      return `${chainServerId}:${getCowSwapTokenAddress(token, chainServerId)}`;
    } catch {
      return null;
    }
  };

  const confirmRiskToken = (token: TokenItem, onConfirm?: () => void) => {
    const key = getRiskTokenKey(token);
    if (!key) return;
    const expectedChainServerId = chainServerId;
    Modal.confirm({
      title: 'Verify this token contract',
      content: (
        <div className="break-all text-r-neutral-body">
          This token is not on the reviewed default list. Only continue if you
          trust the contract on {selectedChain?.name}: {token.id}
        </div>
      ),
      okText: 'I trust this token',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      getContainer,
      onOk: () => {
        if (activeChainRef.current !== expectedChainServerId) {
          throw new Error('Chain changed; select the token again');
        }
        setConfirmedRiskTokenKeys((current) =>
          current.includes(key) ? current : [...current, key]
        );
        onConfirm?.();
      },
    });
  };

  const applyTokenSelection = (mode: 'sell' | 'buy', token: TokenItem) => {
    const address = getCowSwapTokenAddress(token, chainServerId);
    if (
      (mode === 'sell' && address === toAddress) ||
      (mode === 'buy' && address === fromAddress)
    ) {
      message.error('Sell and buy tokens must differ');
      return;
    }
    if (mode === 'sell') {
      setFromAddress(address);
      setFromTokenItem(token);
      setAmount('');
    } else {
      setToAddress(address);
      setToTokenItem(token);
    }
    resetQuote();
  };

  const selectToken = (mode: 'sell' | 'buy', token: TokenItem) => {
    try {
      const riskKey = getRiskTokenKey(token);
      setTokenSelectorMode(null);
      if (
        riskKey &&
        isRiskyCowSwapToken(token) &&
        !confirmedRiskTokenKeys.includes(riskKey)
      ) {
        confirmRiskToken(token, () => applyTokenSelection(mode, token));
      } else {
        applyTokenSelection(mode, token);
      }
    } catch (error: any) {
      message.error(error?.message || 'Unable to select token');
    }
  };

  const reverseTokens = () => {
    if (!fromTokenItem || !toTokenItem) return;
    const previousFromAddress = fromAddress;
    const previousFromTokenItem = fromTokenItem;
    setFromAddress(toAddress);
    setFromTokenItem(toTokenItem);
    setToAddress(previousFromAddress);
    setToTokenItem(previousFromTokenItem);
    setAmount('');
    resetQuote();
  };

  const buildQuoteRequest = () => {
    if (!account || !fromToken || !toToken) {
      throw new Error('Load both tokens first');
    }
    const amountIn = ethers.utils.parseUnits(amount, fromToken.decimals);
    if (amountIn.lte(0)) throw new Error('Enter a positive sell amount');
    return {
      chainServerId,
      fromToken: {
        address: fromToken.address,
        decimals: fromToken.decimals,
        symbol: fromToken.symbol,
      },
      toToken: {
        address: toToken.address,
        decimals: toToken.decimals,
        symbol: toToken.symbol,
      },
      amount: amountIn.toString(),
      userAddress: account.address,
      slippage,
    };
  };

  const refreshAllowance = async (nextQuote: ValidatedCowSwapQuote) => {
    if (!nextQuote.approvalSpender || nextQuote.nativeSell || !fromToken) {
      setAllowance(nextQuote.amountIn);
      return;
    }
    const value = await wallet.getERC20Allowance(
      chainServerId,
      fromToken.address,
      nextQuote.approvalSpender
    );
    setAllowance(String(value));
  };

  const requestQuote = async () => {
    const generation = inputGenerationRef.current;
    const expectedOwner = account?.address?.toLowerCase();
    const expectedChainServerId = chainServerId;
    setQuoting(true);
    try {
      const nextQuote = await wallet.getCowSwapQuote(buildQuoteRequest());
      if (
        inputGenerationRef.current !== generation ||
        !expectedOwner ||
        activeAccountRef.current !== expectedOwner ||
        activeChainRef.current !== expectedChainServerId
      ) {
        return;
      }
      setQuote(nextQuote);
      await refreshAllowance(nextQuote);
    } catch (error: any) {
      if (inputGenerationRef.current === generation) {
        setQuote(null);
        message.error(error?.message || 'CoW quote failed');
      }
    } finally {
      if (inputGenerationRef.current === generation) {
        setQuoting(false);
      }
    }
  };

  const waitForReceipt = async (
    hash: string,
    receiptChainServerId = chainServerId
  ) => {
    if (!account || !receiptChainServerId) {
      throw new Error('No active account or chain');
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new Error('Wallet returned an invalid transaction hash');
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt < RECEIPT_TIMEOUT_MS) {
      const receipt = await getCowSwapTransactionReceipt(
        wallet,
        account,
        receiptChainServerId,
        hash
      );
      if (receipt) {
        if (
          String(receipt.transactionHash).toLowerCase() !== hash.toLowerCase()
        ) {
          throw new Error('RPC returned a mismatched transaction receipt');
        }
        if (receipt.status !== '0x1') {
          const error: Error & { code?: string } = new Error(
            'Transaction reverted'
          );
          error.code = 'COW_TX_REVERTED';
          throw error;
        }
        return receipt;
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
    throw new Error(
      'Transaction receipt is still pending. Check the chain before retrying.'
    );
  };

  const approve = async () => {
    if (
      !quote ||
      !quote.approvalSpender ||
      !fromToken ||
      !account ||
      !selectedChain
    ) {
      return;
    }
    const expectedOwner = account.address.toLowerCase();
    const expectedChainServerId = chainServerId;
    const expectedGeneration = inputGenerationRef.current;
    setApproving(true);
    try {
      const approveInterface = new ethers.utils.Interface([
        'function approve(address spender,uint256 amount) returns (bool)',
      ]);
      const sendApproval = async (approvalAmount: string) => {
        assertActiveContext(expectedOwner, expectedChainServerId);
        if (inputGenerationRef.current !== expectedGeneration) {
          throw new Error('Swap input changed; review the CoW approval again');
        }
        const hash = await sendCowSwapTransaction(
          wallet,
          account,
          Number(selectedChain.id),
          {
            from: account.address,
            to: fromToken.address,
            data: approveInterface.encodeFunctionData('approve', [
              quote.approvalSpender,
              approvalAmount,
            ]),
            value: '0x0',
          }
        );
        await waitForReceipt(hash);
      };
      if (
        BigInt(allowance) > 0n &&
        BigInt(allowance) !== BigInt(quote.amountIn)
      ) {
        await sendApproval('0');
      }
      await sendApproval(quote.amountIn);
      setAllowance(quote.amountIn);
      message.success('Exact CoW vault-relayer approval confirmed');
    } catch (error: any) {
      message.error(error?.message || 'Approval failed');
    } finally {
      setApproving(false);
    }
  };

  const addHistoryOrder = (
    fresh: ValidatedCowSwapQuote,
    orderUid: string,
    explorerUrl: string,
    status: LocalCowSwapOrder['status'],
    creationTxHash?: string
  ) => {
    if (!account || !fromToken || !toToken) return;
    const now = Date.now();
    const entry: LocalCowSwapOrder = {
      orderUid,
      ownerAddress: account.address.toLowerCase(),
      chainServerId,
      chainId: fresh.chainId,
      fromToken: fresh.fromToken,
      toToken: fresh.toToken,
      fromSymbol: fromToken.symbol,
      toSymbol: toToken.symbol,
      fromDecimals: fromToken.decimals,
      toDecimals: toToken.decimals,
      amountIn: fresh.amountIn,
      amountOut: fresh.amountOut,
      minimumAmountOut: fresh.minimumAmountOut,
      nativeSell: fresh.nativeSell,
      creationTxHash,
      status,
      explorerUrl,
      createdAt: now,
      updatedAt: now,
    };
    if (activeAccountRef.current !== entry.ownerAddress) {
      writeHistory([
        entry,
        ...readHistory().filter((item) => item.orderUid !== orderUid),
      ]);
      return;
    }
    persistHistory((current) => [
      entry,
      ...current.filter((item) => item.orderUid !== orderUid),
    ]);
  };

  const submit = async () => {
    if (!quote || !account || !selectedChain) return;
    let nativeQuoteConsumed = false;
    const expectedOwner = account.address.toLowerCase();
    const expectedChainServerId = chainServerId;
    const expectedGeneration = inputGenerationRef.current;
    const assertSubmissionContext = () => {
      assertActiveContext(expectedOwner, expectedChainServerId);
      if (inputGenerationRef.current !== expectedGeneration) {
        throw new Error('Swap input changed; review the CoW order again');
      }
    };
    setSubmitting(true);
    try {
      if (!isReviewedCowSwapQuoteExecutable(quote)) {
        const refreshed = await wallet.getCowSwapQuote(buildQuoteRequest());
        assertSubmissionContext();
        setQuote(refreshed);
        await refreshAllowance(refreshed);
        throw new Error(
          'The reviewed CoW order expired. Review the updated order before signing.'
        );
      }
      if (!quote.nativeSell) {
        const freshAllowance = await wallet.getERC20Allowance(
          chainServerId,
          fromToken!.address,
          quote.approvalSpender!
        );
        setAllowance(String(freshAllowance));
        if (BigInt(freshAllowance) !== BigInt(quote.amountIn)) {
          throw new Error('The exact approval is missing or changed');
        }
        if (!quote.signingPayload)
          throw new Error('CoW signing payload is missing');
        assertSubmissionContext();
        const signature = await signCowSwapTypedData(
          wallet,
          account,
          quote.chainId,
          quote.signingPayload
        );
        const recovered = ethers.utils.verifyTypedData(
          quote.signingPayload.domain,
          withoutDomainType(quote.signingPayload.types),
          quote.signingPayload.message,
          signature
        );
        if (recovered.toLowerCase() !== account.address.toLowerCase()) {
          throw new Error('Order signature did not recover the active account');
        }
        assertSubmissionContext();
        const result = await wallet.submitCowSwapOrder({
          quoteHandle: quote.quoteHandle,
          chainServerId,
          userAddress: account.address,
          signature,
        });
        addHistoryOrder(
          quote,
          result.orderUid,
          result.explorerUrl,
          result.status === 'ambiguous' ? 'notFound' : result.status
        );
        if (result.status === 'ambiguous') {
          message.warning(
            'Submission outcome is ambiguous. The expected UID is stored locally; check it before placing another order.'
          );
        } else {
          message.success('CoW order submitted');
        }
      } else {
        assertSubmissionContext();
        const prepared = await wallet.consumeCowSwapNativeOrder({
          quoteHandle: quote.quoteHandle,
          chainServerId,
          userAddress: account.address,
        });
        nativeQuoteConsumed = true;
        assertSubmissionContext();
        const hash = await sendCowSwapTransaction(
          wallet,
          account,
          Number(selectedChain.id),
          prepared.transaction
        );
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
          throw new Error(
            'Wallet returned an invalid EthFlow transaction hash'
          );
        }
        addHistoryOrder(
          quote,
          prepared.orderUid,
          prepared.explorerUrl,
          'creating',
          hash
        );
        try {
          await waitForReceipt(hash);
        } catch (error: any) {
          if (error?.code === 'COW_TX_REVERTED') {
            persistHistory((current) =>
              current.map((item) =>
                item.orderUid === prepared.orderUid
                  ? { ...item, status: 'failed', updatedAt: Date.now() }
                  : item
              )
            );
          }
          throw error;
        }
        message.success('CoW EthFlow order deposited on-chain');
      }
      setQuote(null);
      setAllowance('0');
    } catch (error: any) {
      if (nativeQuoteConsumed) {
        setQuote(null);
        setAllowance('0');
      }
      message.error(error?.message || 'CoW order submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const refreshOrderStatuses = useCallback(async () => {
    if (!account) return;
    const expectedOwner = account.address.toLowerCase();
    const pending = historyRef.current
      .filter(
        (item) =>
          item.status !== 'fulfilled' &&
          item.status !== 'cancelled' &&
          item.status !== 'refunded' &&
          item.status !== 'failed' &&
          !(item.status === 'expired' && !item.nativeSell)
      )
      .slice(0, 10);
    if (!pending.length) return;
    const updates = await Promise.all(
      pending.map(async (item) => {
        try {
          return await wallet.getCowSwapOrderStatus({
            chainServerId: item.chainServerId,
            orderUid: item.orderUid,
            ownerAddress: account.address,
          });
        } catch {
          return null;
        }
      })
    );
    if (activeAccountRef.current !== expectedOwner) return;
    persistHistory((current) =>
      current.map((item) => {
        const status = updates.find(
          (update): update is CowSwapOrderStatus =>
            !!update && update.orderUid === item.orderUid
        );
        if (
          !status ||
          (status.status === 'notFound' && item.status === 'creating')
        ) {
          return item;
        }
        return {
          ...item,
          status:
            status.isNativeSell && status.refundTxHash
              ? 'refunded'
              : status.status,
          explorerUrl: status.explorerUrl,
          updatedAt: Date.now(),
        };
      })
    );
  }, [account, persistHistory, wallet]);

  useEffect(() => {
    void refreshOrderStatuses();
    const timer = window.setInterval(() => {
      void refreshOrderStatuses();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [refreshOrderStatuses]);

  const cancelOrder = async (order: LocalCowSwapOrder) => {
    if (!account) return;
    const expectedOwner = account.address.toLowerCase();
    if (order.ownerAddress.toLowerCase() !== expectedOwner) return;
    setCancellingUid(order.orderUid);
    try {
      const orderChain = findChain({ serverId: order.chainServerId });
      if (!orderChain) throw new Error('Order chain is unavailable');
      const prepared = await wallet.prepareCowSwapCancellation({
        chainServerId: order.chainServerId,
        orderUid: order.orderUid,
        ownerAddress: account.address,
      });
      if (activeAccountRef.current !== expectedOwner) {
        throw new Error('Account changed; review the CoW cancellation again');
      }
      let cancellationTxHash: string | undefined;
      let finalStatus:
        | LocalCowSwapOrder['status']
        | 'ambiguous' = order.nativeSell ? 'refunded' : 'cancelled';
      if (prepared.type === 'signature') {
        const signature = await signCowSwapTypedData(
          wallet,
          account,
          order.chainId,
          prepared.signingPayload
        );
        const recovered = ethers.utils.verifyTypedData(
          prepared.signingPayload.domain,
          withoutDomainType(prepared.signingPayload.types),
          prepared.signingPayload.message,
          signature
        );
        if (recovered.toLowerCase() !== account.address.toLowerCase()) {
          throw new Error('Cancellation signature account mismatch');
        }
        if (activeAccountRef.current !== expectedOwner) {
          throw new Error('Account changed; review the CoW cancellation again');
        }
        const result = await wallet.submitCowSwapCancellation({
          cancellationHandle: prepared.cancellationHandle,
          chainServerId: order.chainServerId,
          ownerAddress: account.address,
          signature,
        });
        finalStatus = result.status;
      } else {
        if (activeAccountRef.current !== expectedOwner) {
          throw new Error('Account changed; review the CoW cancellation again');
        }
        const txHash = await sendCowSwapTransaction(
          wallet,
          account,
          Number(orderChain.id),
          prepared.transaction
        );
        cancellationTxHash = txHash;
        persistHistory((current) =>
          current.map((item) =>
            item.orderUid === order.orderUid
              ? { ...item, cancellationTxHash: txHash, updatedAt: Date.now() }
              : item
          )
        );
        await waitForReceipt(txHash, order.chainServerId);
      }
      const updateCancellationHistory = (current: LocalCowSwapOrder[]) =>
        current.map((item) =>
          item.orderUid === order.orderUid
            ? {
                ...item,
                status: finalStatus === 'ambiguous' ? item.status : finalStatus,
                cancellationTxHash,
                updatedAt: Date.now(),
              }
            : item
        );
      if (activeAccountRef.current !== expectedOwner) {
        writeHistory(updateCancellationHistory(readHistory()));
      } else {
        persistHistory(updateCancellationHistory);
      }
      if (finalStatus === 'ambiguous') {
        message.warning(
          'Cancellation outcome is ambiguous. Refresh the stored UID before placing another order.'
        );
      } else if (finalStatus === 'cancelled' || finalStatus === 'refunded') {
        message.success(
          order.nativeSell
            ? 'EthFlow order invalidated and remaining native token refunded'
            : 'CoW cancellation confirmed'
        );
      } else {
        message.warning(
          `The order reached ${finalStatus} before cancellation.`
        );
      }
    } catch (error: any) {
      message.error(error?.message || 'Order cancellation failed');
    } finally {
      setCancellingUid(null);
    }
  };

  const allowanceEnough =
    !!quote &&
    (quote.nativeSell || BigInt(allowance || '0') === BigInt(quote.amountIn));
  let parsedAmount: ethers.BigNumber | null = null;
  try {
    parsedAmount = fromToken
      ? ethers.utils.parseUnits(amount || '0', fromToken.decimals)
      : null;
  } catch {
    parsedAmount = null;
  }
  const amountIsPositive = Boolean(parsedAmount?.gt(0));
  const amountTooHigh = Boolean(
    parsedAmount && fromToken && parsedAmount.gt(fromToken.balance)
  );
  const selectedTokenItems = [
    fromTokenItem,
    toTokenItem,
  ].filter((token): token is TokenItem => Boolean(token));
  const unconfirmedRiskTokens = selectedTokenItems.filter((token) => {
    const key = getRiskTokenKey(token);
    return (
      isRiskyCowSwapToken(token) &&
      Boolean(key) &&
      !confirmedRiskTokenKeys.includes(key!)
    );
  });
  const hasUnconfirmedRiskToken = unconfirmedRiskTokens.length > 0;

  const useMaximumBalance = () => {
    if (!fromToken || fromToken.address === COW_SWAP_NATIVE_TOKEN) return;
    setAmount(ethers.utils.formatUnits(fromToken.balance, fromToken.decimals));
    resetQuote();
  };

  if (routeError) {
    return (
      <div className="p-20">
        <Alert
          type="error"
          showIcon
          message="Unable to open swap"
          description={routeError}
        />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="p-20">
        <Alert type="warning" showIcon message="Select an account to trade" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-r-neutral-bg-2 p-16">
      <div className="mb-12">
        <div className="text-[20px] font-semibold text-r-neutral-title-1">
          CoW Swap
        </div>
        <div className="mt-4 text-[12px] text-r-neutral-foot">
          Direct same-chain limit orders through CoW Protocol. No intermediary
          quote aggregator or Rabby trade relay.
        </div>
      </div>

      <Alert
        className="mb-12"
        type="info"
        showIcon
        message="Orders are signed for CoW Protocol and remain open until filled, cancelled or expired. Selling a native token deposits it into the official EthFlow contract."
      />

      <div className="rounded-[12px] bg-r-neutral-card-1 p-16">
        <div className="mb-8 text-[12px] text-r-neutral-foot">Network</div>
        <Select
          className="mb-12 w-full"
          value={chainServerId}
          options={chainOptions}
          onChange={onChainChange}
        />

        <div className="rounded-[12px] bg-r-neutral-bg-1 p-12">
          <div className="flex items-center justify-between text-[12px] text-r-neutral-foot">
            <span>Sell</span>
            <span>
              Balance:{' '}
              {fromToken
                ? formatTokenAmount(fromToken.balance, fromToken.decimals)
                : loadingTokens
                ? 'Loading...'
                : '--'}
              {fromToken?.address !== COW_SWAP_NATIVE_TOKEN && fromToken ? (
                <button
                  type="button"
                  className="ml-6 border-0 bg-transparent p-0 font-medium text-r-blue-default"
                  onClick={useMaximumBalance}
                >
                  Max
                </button>
              ) : null}
            </span>
          </div>
          <div className="mt-8 flex items-center gap-8">
            <Input
              className="min-w-0 flex-1 border-0 bg-transparent px-0 text-[24px] shadow-none"
              inputMode="decimal"
              value={amount}
              placeholder="0.0"
              onChange={(event) => {
                const nextAmount = event.target.value;
                if (!/^\d*(\.\d*)?$/.test(nextAmount)) return;
                setAmount(nextAmount);
                resetQuote();
              }}
            />
            <SwapTokenButton
              token={fromTokenItem}
              loading={loadingTokens}
              onClick={() => setTokenSelectorMode('sell')}
            />
          </div>
          <div className="mt-6 truncate text-[10px] text-r-neutral-foot">
            {fromAddress === COW_SWAP_NATIVE_TOKEN
              ? `${selectedChain?.name || 'Network'} native token`
              : fromAddress}
          </div>
        </div>

        <div className="relative z-10 flex h-0 justify-center">
          <button
            type="button"
            aria-label="Reverse swap tokens"
            className="mt-[-17px] flex h-[34px] w-[34px] items-center justify-center rounded-full border-4 border-solid border-r-neutral-card-1 bg-r-neutral-bg-1 text-r-neutral-body"
            disabled={!fromTokenItem || !toTokenItem || loadingTokens}
            onClick={reverseTokens}
          >
            <RcIconSwitch className="h-16 w-16 rotate-90" />
          </button>
        </div>

        <div className="mt-4 rounded-[12px] bg-r-neutral-bg-1 p-12">
          <div className="flex items-center justify-between text-[12px] text-r-neutral-foot">
            <span>Buy</span>
            <span>
              Balance:{' '}
              {toToken
                ? formatTokenAmount(toToken.balance, toToken.decimals)
                : loadingTokens
                ? 'Loading...'
                : '--'}
            </span>
          </div>
          <div className="mt-8 flex items-center gap-8">
            <div className="min-w-0 flex-1 truncate text-[24px] text-r-neutral-title-1">
              {quote && toToken
                ? formatTokenAmount(quote.amountOut, toToken.decimals)
                : '0.0'}
            </div>
            <SwapTokenButton
              token={toTokenItem}
              loading={loadingTokens}
              onClick={() => setTokenSelectorMode('buy')}
            />
          </div>
          <div className="mt-6 truncate text-[10px] text-r-neutral-foot">
            {toAddress === COW_SWAP_NATIVE_TOKEN
              ? `${selectedChain?.name || 'Network'} native token`
              : toAddress}
          </div>
        </div>

        {amountTooHigh ? (
          <div className="mt-8 text-[12px] text-r-red-default">
            Amount exceeds your {fromToken?.symbol || 'token'} balance.
          </div>
        ) : null}

        {hasUnconfirmedRiskToken ? (
          <div className="mt-10 flex items-center gap-8 rounded-[8px] bg-r-orange-light p-10 text-[12px] text-r-orange-default">
            <span className="min-w-0 flex-1">
              Review the custom token contract before requesting a quote.
            </span>
            <Button
              size="small"
              danger
              onClick={() => confirmRiskToken(unconfirmedRiskTokens[0])}
            >
              Review
            </Button>
          </div>
        ) : null}

        <div className="mt-14 flex items-center gap-10">
          <div className="flex-1 text-[12px] text-r-neutral-foot">
            Slippage tolerance
          </div>
          <Input
            className="w-[92px] text-right"
            suffix="%"
            value={slippage}
            onChange={(event) => {
              const nextSlippage = event.target.value;
              if (!/^\d*(\.\d*)?$/.test(nextSlippage)) return;
              setSlippage(nextSlippage);
              resetQuote();
            }}
          />
        </div>

        <Button
          className="mt-16"
          type="primary"
          block
          loading={quoting}
          disabled={
            loadingTokens ||
            !fromToken ||
            !toToken ||
            !amountIsPositive ||
            amountTooHigh ||
            hasUnconfirmedRiskToken
          }
          onClick={requestQuote}
        >
          Get verified CoW quote
        </Button>
      </div>

      {tokenSelectorMode ? (
        <CowTokenSelector
          visible
          mode={tokenSelectorMode}
          accountAddress={account.address}
          chainServerId={chainServerId}
          selectedTokens={selectedTokenItems}
          excludedAddress={
            tokenSelectorMode === 'sell' ? toAddress : fromAddress
          }
          onSelect={(token) => selectToken(tokenSelectorMode, token)}
          onClose={() => setTokenSelectorMode(null)}
        />
      ) : null}

      {quote && fromToken && toToken ? (
        <div className="mt-12 rounded-[12px] bg-r-neutral-card-1 p-16">
          <div className="text-[14px] font-semibold text-r-neutral-title-1">
            Review CoW order
          </div>
          <div className="mt-10 space-y-6 text-[12px] text-r-neutral-body">
            <div>
              Sell exactly:{' '}
              {formatTokenAmount(quote.amountIn, fromToken.decimals)}{' '}
              {fromToken.symbol}
            </div>
            <div>
              Quoted output:{' '}
              {formatTokenAmount(quote.amountOut, toToken.decimals)}{' '}
              {toToken.symbol}
            </div>
            <div>
              Signed minimum:{' '}
              {formatTokenAmount(quote.minimumAmountOut, toToken.decimals)}{' '}
              {toToken.symbol}
            </div>
            <div>
              Estimated network cost in sell token:{' '}
              {formatTokenAmount(quote.networkFeeAmount, fromToken.decimals)}{' '}
              {fromToken.symbol}
            </div>
            <div>Protocol fee: {quote.protocolFeeBps} bps</div>
            <div>
              Execution:{' '}
              {quote.nativeSell ? 'official EthFlow deposit' : 'EIP-712 order'}
            </div>
            <div>Expires: {new Date(quote.expiresAt).toLocaleTimeString()}</div>
            <div className="break-all">Sell token: {quote.fromToken}</div>
            <div className="break-all">Buy token: {quote.toToken}</div>
            <div>Order UID: {shortHash(quote.expectedOrderUid)}</div>
          </div>

          {!allowanceEnough && quote.approvalSpender ? (
            <Button
              className="mt-14"
              block
              loading={approving}
              onClick={approve}
            >
              {BigInt(allowance || '0') > 0n
                ? 'Reset and approve exact amount'
                : 'Approve exact amount'}
            </Button>
          ) : null}

          <Button
            className="mt-10"
            type="primary"
            block
            loading={submitting}
            disabled={!allowanceEnough}
            onClick={submit}
          >
            {quote.nativeSell
              ? 'Deposit reviewed order'
              : 'Sign and submit reviewed order'}
          </Button>
        </div>
      ) : null}

      <div className="mt-12 rounded-[12px] bg-r-neutral-card-1 p-16">
        <div className="flex items-center justify-between">
          <div className="text-[14px] font-semibold text-r-neutral-title-1">
            Local CoW order history
          </div>
          <Button size="small" onClick={() => void refreshOrderStatuses()}>
            Refresh
          </Button>
        </div>
        {history.length ? (
          history.slice(0, 10).map((item) => (
            <div
              key={`${item.chainId}:${item.orderUid}`}
              className="mt-10 rounded-[8px] bg-r-neutral-bg-1 p-10 text-[11px] text-r-neutral-body"
            >
              <div className="flex items-center justify-between gap-8">
                <span className="font-medium">
                  {formatTokenAmount(item.amountIn, item.fromDecimals)}{' '}
                  {item.fromSymbol} → {item.toSymbol}
                </span>
                <span>{item.status}</span>
              </div>
              <div className="mt-4">{shortHash(item.orderUid)}</div>
              <div className="mt-8 flex gap-8">
                <Button
                  size="small"
                  onClick={() => {
                    const trustedUrl = getTrustedExplorerUrl(item);
                    if (trustedUrl) {
                      window.open(trustedUrl, '_blank', 'noopener,noreferrer');
                    }
                  }}
                >
                  Explorer
                </Button>
                {(item.status === 'open' ||
                  item.status === 'presignaturePending' ||
                  (item.nativeSell && item.status === 'expired')) && (
                  <Button
                    size="small"
                    danger
                    loading={cancellingUid === item.orderUid}
                    onClick={() => void cancelOrder(item)}
                  >
                    Cancel / refund
                  </Button>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="mt-10 text-[12px] text-r-neutral-foot">
            No local CoW orders for this account.
          </div>
        )}
      </div>
    </div>
  );
};

export default Swap;
