import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Alert, Button, Input, Select, message } from 'antd';
import { ethers } from 'ethers';
import { useCurrentAccount } from '@/ui/hooks/backgroundState/useAccount';
import { useWallet } from '@/ui/utils';
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
import { isFreshCowSwapQuoteSafe } from './cowSwapSafety';

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

const isAddressOrNative = (value: string) =>
  /^(native|eth)$/i.test(value.trim()) || ethers.utils.isAddress(value.trim());

const normalizeInputAddress = (value: string) =>
  /^(native|eth)$/i.test(value.trim())
    ? COW_SWAP_NATIVE_TOKEN
    : ethers.utils.getAddress(value.trim()).toLowerCase();

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

const Swap = () => {
  const wallet = useWallet();
  const account = useCurrentAccount();
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
  const initialChain = chainOptions[0];
  const [chainServerId, setChainServerId] = useState(
    initialChain?.value || 'eth'
  );
  const selectedChain = useMemo(() => findChain({ serverId: chainServerId }), [
    chainServerId,
  ]);
  const selectedConfig = selectedChain
    ? COW_SWAP_CHAIN_CONFIG_BY_ID[Number(selectedChain.id)]
    : undefined;
  const [fromAddress, setFromAddress] = useState(COW_SWAP_NATIVE_TOKEN);
  const [toAddress, setToAddress] = useState(
    selectedConfig?.defaultOutputToken || ''
  );
  const [fromToken, setFromToken] = useState<CowSwapTokenMetadata | null>(null);
  const [toToken, setToToken] = useState<CowSwapTokenMetadata | null>(null);
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [quote, setQuote] = useState<ValidatedCowSwapQuote | null>(null);
  const [allowance, setAllowance] = useState('0');
  const [history, setHistory] = useState<LocalCowSwapOrder[]>([]);
  const historyRef = useRef<LocalCowSwapOrder[]>([]);
  const inputGenerationRef = useRef(0);
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
    setFromToken(null);
    setToToken(null);
    setAmount('');
    setQuote(null);
    setAllowance('0');
    setLoadingTokens(false);
    setQuoting(false);
    setHistory(
      readHistory().filter((item) => item.ownerAddress.toLowerCase() === owner)
    );
  }, [account?.address]);

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
    setLoadingTokens(false);
    setQuoting(false);
  };

  const onChainChange = (nextServerId: string) => {
    const nextChain = findChain({ serverId: nextServerId });
    const config = nextChain
      ? COW_SWAP_CHAIN_CONFIG_BY_ID[Number(nextChain.id)]
      : undefined;
    setChainServerId(nextServerId);
    setFromAddress(COW_SWAP_NATIVE_TOKEN);
    setToAddress(config?.defaultOutputToken || '');
    setFromToken(null);
    setToToken(null);
    setAmount('');
    resetQuote();
  };

  const loadTokens = async () => {
    if (!account || !selectedChain) return;
    if (!isAddressOrNative(fromAddress) || !isAddressOrNative(toAddress)) {
      message.error('Enter valid token addresses or use native');
      return;
    }
    resetQuote();
    setLoadingTokens(true);
    const generation = inputGenerationRef.current;
    const expectedOwner = account.address.toLowerCase();
    const expectedChainServerId = chainServerId;
    try {
      const [sell, buy] = await Promise.all([
        wallet.getCowSwapTokenMetadata({
          chainServerId,
          tokenAddress: normalizeInputAddress(fromAddress),
          ownerAddress: account.address,
        }),
        wallet.getCowSwapTokenMetadata({
          chainServerId,
          tokenAddress: normalizeInputAddress(toAddress),
          ownerAddress: account.address,
        }),
      ]);
      if (
        inputGenerationRef.current !== generation ||
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
    } catch (error: any) {
      if (inputGenerationRef.current === generation) {
        setFromToken(null);
        setToToken(null);
        message.error(error?.message || 'Unable to read token metadata');
      }
    } finally {
      if (inputGenerationRef.current === generation) {
        setLoadingTokens(false);
      }
    }
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

  const requestOnSelectedChain = async <T,>(
    method: string,
    params: any[]
  ): Promise<T> => {
    if (!account || !selectedChain)
      throw new Error('No active account or chain');
    return (await wallet.requestETHRpc(
      { method, params },
      String(selectedChain.id),
      account
    )) as T;
  };

  const waitForReceipt = async (
    hash: string,
    chainId = String(selectedChain?.id || '')
  ) => {
    if (!account || !chainId) throw new Error('No active account or chain');
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
      throw new Error('Wallet returned an invalid transaction hash');
    }
    const startedAt = Date.now();
    while (Date.now() - startedAt < RECEIPT_TIMEOUT_MS) {
      const receipt = await wallet.requestETHRpc<any>(
        { method: 'eth_getTransactionReceipt', params: [hash] },
        chainId,
        account
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
    if (!quote || !quote.approvalSpender || !fromToken || !account) return;
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
        const hash = await requestOnSelectedChain<string>(
          'eth_sendTransaction',
          [
            {
              from: account!.address,
              to: fromToken.address,
              data: approveInterface.encodeFunctionData('approve', [
                quote.approvalSpender,
                approvalAmount,
              ]),
              value: '0x0',
            },
          ]
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
      const fresh = await wallet.getCowSwapQuote(buildQuoteRequest());
      assertSubmissionContext();
      if (!isFreshCowSwapQuoteSafe(quote, fresh)) {
        setQuote(fresh);
        await refreshAllowance(fresh);
        throw new Error(
          'The fresh CoW order no longer preserves the reviewed minimum. Review it again.'
        );
      }
      if (!fresh.nativeSell) {
        const freshAllowance = await wallet.getERC20Allowance(
          chainServerId,
          fromToken!.address,
          fresh.approvalSpender!
        );
        setAllowance(String(freshAllowance));
        if (BigInt(freshAllowance) !== BigInt(fresh.amountIn)) {
          setQuote(fresh);
          throw new Error('The exact approval is missing or changed');
        }
        if (!fresh.signingPayload)
          throw new Error('CoW signing payload is missing');
        assertSubmissionContext();
        const signature = await requestOnSelectedChain<string>(
          'eth_signTypedData_v4',
          [account.address, JSON.stringify(fresh.signingPayload)]
        );
        const recovered = ethers.utils.verifyTypedData(
          fresh.signingPayload.domain,
          withoutDomainType(fresh.signingPayload.types),
          fresh.signingPayload.message,
          signature
        );
        if (recovered.toLowerCase() !== account.address.toLowerCase()) {
          throw new Error('Order signature did not recover the active account');
        }
        assertSubmissionContext();
        const result = await wallet.submitCowSwapOrder({
          quoteHandle: fresh.quoteHandle,
          chainServerId,
          userAddress: account.address,
          signature,
        });
        addHistoryOrder(
          fresh,
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
          quoteHandle: fresh.quoteHandle,
          chainServerId,
          userAddress: account.address,
        });
        assertSubmissionContext();
        const hash = await requestOnSelectedChain<string>(
          'eth_sendTransaction',
          [prepared.transaction]
        );
        if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
          throw new Error(
            'Wallet returned an invalid EthFlow transaction hash'
          );
        }
        addHistoryOrder(
          fresh,
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
        const signature = await wallet.requestETHRpc<string>(
          {
            method: 'eth_signTypedData_v4',
            params: [account.address, JSON.stringify(prepared.signingPayload)],
          },
          String(orderChain.id),
          account
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
        const txHash = await wallet.requestETHRpc<string>(
          { method: 'eth_sendTransaction', params: [prepared.transaction] },
          String(orderChain.id),
          account
        );
        cancellationTxHash = txHash;
        await waitForReceipt(txHash, String(orderChain.id));
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
          className="mb-14 w-full"
          value={chainServerId}
          options={chainOptions}
          onChange={onChainChange}
        />

        <div className="mb-6 text-[12px] text-r-neutral-foot">
          Sell token address (`native` for the chain coin)
        </div>
        <Input
          className="mb-12"
          value={fromAddress}
          onChange={(event) => {
            setFromAddress(event.target.value);
            setFromToken(null);
            resetQuote();
          }}
        />

        <div className="mb-6 text-[12px] text-r-neutral-foot">
          Buy token address (`native` for native output)
        </div>
        <Input
          className="mb-12"
          value={toAddress}
          onChange={(event) => {
            setToAddress(event.target.value);
            setToToken(null);
            resetQuote();
          }}
        />

        <Button
          block
          loading={loadingTokens}
          disabled={
            !isAddressOrNative(fromAddress) || !isAddressOrNative(toAddress)
          }
          onClick={loadTokens}
        >
          Load token data from selected RPC
        </Button>

        {fromToken && toToken ? (
          <div className="mt-10 rounded-[8px] bg-r-neutral-bg-1 p-10 text-[12px] text-r-neutral-body">
            <div>
              Sell: {fromToken.symbol} · balance{' '}
              {formatTokenAmount(fromToken.balance, fromToken.decimals)}
            </div>
            <div className="mt-4">
              Buy: {toToken.symbol} · balance{' '}
              {formatTokenAmount(toToken.balance, toToken.decimals)}
            </div>
          </div>
        ) : null}

        <div className="mb-6 mt-14 text-[12px] text-r-neutral-foot">
          Sell amount
        </div>
        <Input
          value={amount}
          placeholder="0.0"
          onChange={(event) => {
            setAmount(event.target.value);
            resetQuote();
          }}
        />

        <div className="mb-6 mt-14 text-[12px] text-r-neutral-foot">
          Slippage tolerance (%)
        </div>
        <Input
          value={slippage}
          onChange={(event) => {
            setSlippage(event.target.value);
            resetQuote();
          }}
        />

        <Button
          className="mt-16"
          type="primary"
          block
          loading={quoting}
          disabled={!fromToken || !toToken || !amount}
          onClick={requestQuote}
        >
          Get verified CoW quote
        </Button>
      </div>

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
              ? 'Refresh, review and deposit order'
              : 'Refresh, sign and submit order'}
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
