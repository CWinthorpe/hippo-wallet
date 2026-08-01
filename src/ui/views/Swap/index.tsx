import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, Select, message } from 'antd';
import { ethers } from 'ethers';
import browser from 'webextension-polyfill';
import { FullscreenContainer } from '@/ui/component/FullscreenContainer';
import { useCurrentAccount } from '@/ui/hooks/backgroundState/useAccount';
import { findChain } from '@/utils/chain';
import { getUiType, useWallet } from '@/ui/utils';
import { LLAMASWAP_NATIVE_TOKEN } from '@/constant/llama-swap';

const SUPPORTED_CHAIN_IDS = [
  'eth',
  'bsc',
  'matic',
  'op',
  'arb',
  'avax',
  'xdai',
  'era',
  'base',
  'linea',
];

const DEFAULT_OUTPUT_TOKEN: Record<string, string> = {
  eth: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  bsc: '0x55d398326f99059ff775485246999027b3197955',
  matic: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  op: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
  arb: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
  avax: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
  base: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
};

interface TokenMetadata {
  address: string;
  decimals: number;
  symbol: string;
  balance: string;
}

interface Quote {
  provider: string;
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
  quoteId: string;
}

const normalizeAddressInput = (value: string) => {
  const trimmed = value.trim();
  if (/^(native|eth)$/i.test(trimmed)) return LLAMASWAP_NATIVE_TOKEN;
  return ethers.utils.getAddress(trimmed).toLowerCase();
};

const waitForReceipt = async (
  wallet: ReturnType<typeof useWallet>,
  chainId: number,
  hash: string
) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    const receipt = await wallet.requestETHRpc(
      { method: 'eth_getTransactionReceipt', params: [hash] },
      String(chainId)
    );
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(
    `Transaction is still pending. Hash: ${hash}. Hippo will not rebroadcast it automatically.`
  );
};

const Swap = () => {
  const wallet = useWallet();
  const account = useCurrentAccount();
  const isTab = getUiType().isTab;
  const [chainServerId, setChainServerId] = useState('eth');
  const chain = useMemo(() => findChain({ serverId: chainServerId }), [
    chainServerId,
  ]);
  const [fromAddress, setFromAddress] = useState(LLAMASWAP_NATIVE_TOKEN);
  const [toAddress, setToAddress] = useState(DEFAULT_OUTPUT_TOKEN.eth);
  const [fromToken, setFromToken] = useState<TokenMetadata>();
  const [toToken, setToToken] = useState<TokenMetadata>();
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('0.5');
  const [quote, setQuote] = useState<Quote>();
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [allowanceEnough, setAllowanceEnough] = useState(false);
  const [error, setError] = useState('');

  const loadToken = async (address: string) => {
    if (!account) throw new Error('No active account');
    return wallet.getLlamaSwapTokenMetadata({
      chainServerId,
      tokenAddress: normalizeAddressInput(address),
      ownerAddress: account.address,
    });
  };

  useEffect(() => {
    const nextOutput = DEFAULT_OUTPUT_TOKEN[chainServerId] || '';
    setFromAddress(LLAMASWAP_NATIVE_TOKEN);
    setToAddress(nextOutput);
    setFromToken(undefined);
    setToToken(undefined);
    setQuote(undefined);
    setAllowanceEnough(false);
  }, [chainServerId]);

  useEffect(() => {
    if (!account) return;
    void loadToken(fromAddress)
      .then(setFromToken)
      .catch((e) => setError(e.message));
  }, [account?.address, chainServerId, fromAddress]);

  useEffect(() => {
    if (!account || !toAddress) return;
    void loadToken(toAddress)
      .then(setToToken)
      .catch((e) => setError(e.message));
  }, [account?.address, chainServerId, toAddress]);

  const rawAmount = useMemo(() => {
    try {
      return fromToken && amount
        ? ethers.utils.parseUnits(amount, fromToken.decimals).toString()
        : '';
    } catch {
      return '';
    }
  }, [amount, fromToken]);

  const quoteRequest = useMemo(
    () =>
      account && fromToken && toToken && rawAmount
        ? {
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
            amount: rawAmount,
            userAddress: account.address,
            slippage,
          }
        : undefined,
    [account, chainServerId, fromToken, rawAmount, slippage, toToken]
  );

  const refreshAllowance = async (nextQuote: Quote) => {
    if (!fromToken || !account) return;
    if (fromToken.address === LLAMASWAP_NATIVE_TOKEN) {
      setAllowanceEnough(true);
      return;
    }
    const allowance = await wallet.getERC20Allowance(
      chainServerId,
      fromToken.address,
      nextQuote.approvalSpender
    );
    setAllowanceEnough(BigInt(allowance) >= BigInt(nextQuote.amountIn));
  };

  const fetchQuote = async () => {
    if (!quoteRequest) {
      setError('Enter valid token addresses and an amount.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const nextQuote = (await wallet.getLlamaSwapQuote(quoteRequest)) as Quote;
      setQuote(nextQuote);
      await refreshAllowance(nextQuote);
    } catch (e: any) {
      setQuote(undefined);
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const approve = async () => {
    if (!account || !chain || !fromToken || !quote) return;
    setApproving(true);
    setError('');
    try {
      const iface = new ethers.utils.Interface([
        'function approve(address spender,uint256 amount)',
      ]);
      const hash = await wallet.sendRequest<string>(
        {
          method: 'eth_sendTransaction',
          params: [
            {
              from: account.address,
              to: fromToken.address,
              data: iface.encodeFunctionData('approve', [
                quote.approvalSpender,
                quote.amountIn,
              ]),
              value: '0x0',
              chainId: chain.id,
            },
          ],
        },
        { account }
      );
      message.info(`Approval submitted: ${hash}`);
      await waitForReceipt(wallet, chain.id, hash);
      await refreshAllowance(quote);
      message.success('Approval confirmed');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setApproving(false);
    }
  };

  const submitSwap = async () => {
    if (!account || !chain || !quoteRequest || !quote || !toToken) return;
    setSubmitting(true);
    setError('');
    try {
      const fresh = (await wallet.getLlamaSwapQuote(quoteRequest)) as Quote;
      if (BigInt(fresh.amountOut) < BigInt(quote.minimumAmountOut)) {
        setQuote(fresh);
        await refreshAllowance(fresh);
        throw new Error(
          'The quote moved beyond your slippage limit. Review it again.'
        );
      }
      if (
        fresh.chainServerId !== quote.chainServerId ||
        fresh.fromToken !== quote.fromToken ||
        fresh.toToken !== quote.toToken ||
        fresh.amountIn !== quote.amountIn ||
        fresh.transaction.from.toLowerCase() !== account.address.toLowerCase()
      ) {
        throw new Error(
          'Fresh LlamaSwap quote does not match the reviewed swap.'
        );
      }
      const hash = await wallet.sendRequest<string>(
        {
          method: 'eth_sendTransaction',
          params: [
            {
              ...fresh.transaction,
              chainId: chain.id,
            },
          ],
        },
        { account }
      );
      const key = 'hippoLocalSwapHistory';
      const stored = await browser.storage.local.get(key);
      const history = Array.isArray(stored[key]) ? stored[key] : [];
      await browser.storage.local.set({
        [key]: [
          {
            hash,
            chainServerId,
            fromToken: fresh.fromToken,
            toToken: fresh.toToken,
            amountIn: fresh.amountIn,
            amountOut: fresh.amountOut,
            provider: fresh.provider,
            createdAt: Date.now(),
          },
          ...history,
        ].slice(0, 100),
      });
      message.success(`Swap submitted: ${hash}`);
      setQuote(undefined);
      setAmount('');
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const outputAmount =
    quote && toToken
      ? ethers.utils.formatUnits(quote.amountOut, toToken.decimals)
      : '';

  return (
    <FullscreenContainer className={isTab ? 'h-[700px]' : 'h-[540px]'}>
      <div className="h-full overflow-auto bg-r-neutral-bg-2 px-[16px] py-[18px]">
        <div className="mb-[16px]">
          <div className="text-[20px] font-semibold text-r-neutral-title-1">
            Same-chain swap
          </div>
          <div className="mt-[4px] text-[12px] text-r-neutral-foot">
            Quotes: LlamaSwap frontend API · Gas and broadcast: selected RPC
          </div>
        </div>

        <label className="text-[12px] text-r-neutral-foot">Network</label>
        <Select
          className="w-full mt-[6px] mb-[12px]"
          value={chainServerId}
          onChange={setChainServerId}
          options={SUPPORTED_CHAIN_IDS.map((serverId) => {
            const item = findChain({ serverId });
            return { value: serverId, label: item?.name || serverId };
          })}
        />

        <label className="text-[12px] text-r-neutral-foot">
          Sell token (`native` or contract address)
        </label>
        <Input
          className="mt-[6px] mb-[6px]"
          value={fromAddress}
          onChange={(e) => {
            setFromAddress(e.target.value);
            setQuote(undefined);
          }}
        />
        <div className="mb-[12px] text-[12px] text-r-neutral-foot">
          {fromToken
            ? `${fromToken.symbol} balance: ${ethers.utils.formatUnits(
                fromToken.balance,
                fromToken.decimals
              )}`
            : 'Loading token from selected RPC…'}
        </div>

        <label className="text-[12px] text-r-neutral-foot">Amount</label>
        <Input
          className="mt-[6px] mb-[12px]"
          value={amount}
          inputMode="decimal"
          onChange={(e) => {
            setAmount(e.target.value);
            setQuote(undefined);
          }}
          placeholder="0.0"
        />

        <label className="text-[12px] text-r-neutral-foot">
          Buy token contract
        </label>
        <Input
          className="mt-[6px] mb-[6px]"
          value={toAddress}
          onChange={(e) => {
            setToAddress(e.target.value);
            setQuote(undefined);
          }}
        />
        <div className="mb-[12px] text-[12px] text-r-neutral-foot">
          {toToken
            ? `${toToken.symbol} · ${toToken.decimals} decimals`
            : 'Loading token…'}
        </div>

        <label className="text-[12px] text-r-neutral-foot">Slippage (%)</label>
        <Input
          className="mt-[6px] mb-[14px]"
          value={slippage}
          inputMode="decimal"
          onChange={(e) => {
            setSlippage(e.target.value);
            setQuote(undefined);
          }}
        />

        {error ? (
          <Alert className="mb-[12px]" type="error" showIcon message={error} />
        ) : null}

        {quote && toToken ? (
          <div className="mb-[12px] rounded-[10px] bg-r-neutral-card-1 p-[12px] text-[13px] text-r-neutral-body">
            <div className="flex justify-between">
              <span>Receive</span>
              <strong className="text-r-neutral-title-1">
                {outputAmount} {toToken.symbol}
              </strong>
            </div>
            <div className="mt-[6px] flex justify-between">
              <span>Route</span>
              <span>{quote.provider}</span>
            </div>
            <div className="mt-[6px] flex justify-between">
              <span>Minimum output</span>
              <span>
                {ethers.utils.formatUnits(
                  quote.minimumAmountOut,
                  toToken.decimals
                )}{' '}
                {toToken.symbol}
              </span>
            </div>
          </div>
        ) : null}

        {!quote ? (
          <Button block type="primary" loading={loading} onClick={fetchQuote}>
            Get validated quote
          </Button>
        ) : !allowanceEnough ? (
          <Button block type="primary" loading={approving} onClick={approve}>
            Approve exact amount
          </Button>
        ) : (
          <Button
            block
            type="primary"
            loading={submitting}
            onClick={submitSwap}
          >
            Review and swap
          </Button>
        )}
      </div>
    </FullscreenContainer>
  );
};

export default Swap;
