import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  'sonic',
  'unichain',
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
  permit2?: {
    hash: string;
    domain: {
      name: string;
      chainId: number;
      verifyingContract: string;
    };
    types: Record<string, Array<{ name: string; type: string }>>;
    primaryType: string;
    message: {
      permitted: { token: string; amount: string };
      spender: string;
      nonce: string;
      deadline: string;
    };
  };
  quoteId: string;
  expiresAt: number;
  providersCompared: string[];
  availableProviders: string[];
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
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quote, setQuote] = useState<Quote>();
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [allowanceEnough, setAllowanceEnough] = useState(false);
  const [error, setError] = useState('');
  const quoteGeneration = useRef(0);
  const allowanceGeneration = useRef(0);

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
    setQuotes([]);
    setQuote(undefined);
    setAllowanceEnough(false);
  }, [chainServerId]);

  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    void loadToken(fromAddress)
      .then((token) => {
        if (!cancelled) setFromToken(token);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [account?.address, chainServerId, fromAddress]);

  useEffect(() => {
    if (!account || !toAddress) return;
    let cancelled = false;
    void loadToken(toAddress)
      .then((token) => {
        if (!cancelled) setToToken(token);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
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
    [account?.address, chainServerId, fromToken, rawAmount, slippage, toToken]
  );

  useEffect(() => {
    quoteGeneration.current += 1;
    allowanceGeneration.current += 1;
    setAllowanceEnough(false);
  }, [quoteRequest]);

  const refreshAllowance = async (nextQuote: Quote) => {
    const generation = ++allowanceGeneration.current;
    setAllowanceEnough(false);
    if (!fromToken || !account) return;
    if (fromToken.address === LLAMASWAP_NATIVE_TOKEN) {
      if (generation === allowanceGeneration.current) {
        setAllowanceEnough(true);
      }
      return;
    }
    const allowance = await wallet.getERC20Allowance(
      chainServerId,
      fromToken.address,
      nextQuote.approvalSpender
    );
    if (generation === allowanceGeneration.current) {
      setAllowanceEnough(BigInt(allowance) >= BigInt(nextQuote.amountIn));
    }
  };

  const fetchQuote = async () => {
    if (!quoteRequest) {
      setError('Enter valid token addresses and an amount.');
      return;
    }
    setLoading(true);
    setError('');
    const generation = quoteGeneration.current;
    try {
      const nextQuotes = (await wallet.getLlamaSwapQuotes(
        quoteRequest
      )) as Quote[];
      if (generation !== quoteGeneration.current) return;
      if (!nextQuotes.length) throw new Error('No validated routes available.');
      const nextQuote = nextQuotes[0];
      setQuotes(nextQuotes);
      setQuote(nextQuote);
      await refreshAllowance(nextQuote);
    } catch (e: any) {
      setQuotes([]);
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
    const generation = quoteGeneration.current;
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
      if (generation !== quoteGeneration.current) {
        throw new Error('Swap inputs changed while approval was pending.');
      }
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
    const generation = quoteGeneration.current;
    try {
      const freshQuotes = (await wallet.getLlamaSwapQuotes(
        quoteRequest
      )) as Quote[];
      if (generation !== quoteGeneration.current) {
        throw new Error('Swap inputs changed while refreshing the route.');
      }
      const fresh = freshQuotes.find(
        (candidate) => candidate.provider === quote.provider
      );
      if (!fresh) {
        const replacement = freshQuotes[0];
        setQuotes(freshQuotes);
        setQuote(replacement);
        if (replacement) await refreshAllowance(replacement);
        throw new Error(
          'The selected aggregator no longer has a valid route. Review another route.'
        );
      }
      if (BigInt(fresh.amountOut) < BigInt(quote.minimumAmountOut)) {
        setQuotes(freshQuotes);
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
        fresh.transaction.from.toLowerCase() !==
          account.address.toLowerCase() ||
        fresh.provider !== quote.provider ||
        fresh.approvalSpender !== quote.approvalSpender ||
        fresh.transaction.to !== quote.transaction.to
      ) {
        setQuotes(freshQuotes);
        setQuote(fresh);
        await refreshAllowance(fresh);
        throw new Error(
          'The selected route changed. Review the refreshed route before signing.'
        );
      }

      let transactionData = fresh.transaction.data;
      if (fresh.permit2) {
        const signature = await wallet.sendRequest<string>(
          {
            method: 'eth_signTypedData_v4',
            params: [
              account.address,
              JSON.stringify({
                domain: fresh.permit2.domain,
                types: fresh.permit2.types,
                primaryType: fresh.permit2.primaryType,
                message: fresh.permit2.message,
              }),
            ],
          },
          { account }
        );
        const {
          EIP712Domain: _domain,
          ...verificationTypes
        } = fresh.permit2.types;
        const recovered = ethers.utils.verifyTypedData(
          fresh.permit2.domain,
          verificationTypes,
          fresh.permit2.message,
          signature
        );
        if (recovered.toLowerCase() !== account.address.toLowerCase()) {
          throw new Error(
            'Permit2 signature did not recover the active account.'
          );
        }
        const signatureLength = ethers.utils.hexZeroPad(
          ethers.utils.hexlify(ethers.utils.arrayify(signature).length),
          32
        );
        transactionData = ethers.utils.hexConcat([
          transactionData,
          signatureLength,
          signature,
        ]);
      }
      if (generation !== quoteGeneration.current) {
        throw new Error('Swap inputs changed before transaction submission.');
      }
      const hash = await wallet.sendRequest<string>(
        {
          method: 'eth_sendTransaction',
          params: [
            {
              ...fresh.transaction,
              data: transactionData,
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
      setQuotes([]);
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
            Quote comparison: LlamaSwap frontend API · Execution: selected
            aggregator · Gas and broadcast: selected RPC
          </div>
          <div className="mt-[4px] text-[11px] text-r-neutral-foot">
            Comparing routes opens one temporary inactive DefiLlama API tab for
            same-origin requests, then closes it automatically. The API origin
            may remain in local browser history.
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
            setFromToken(undefined);
            setQuotes([]);
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
            setQuotes([]);
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
            setToToken(undefined);
            setQuotes([]);
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
            setQuotes([]);
            setQuote(undefined);
          }}
        />

        {error ? (
          <Alert className="mb-[12px]" type="error" showIcon message={error} />
        ) : null}

        {quote && toToken ? (
          <div className="mb-[12px] rounded-[10px] bg-r-neutral-card-1 p-[12px] text-[13px] text-r-neutral-body">
            <div className="mb-[10px]">
              <div className="mb-[4px] text-[12px] text-r-neutral-foot">
                Validated aggregator route
              </div>
              <Select
                className="w-full"
                value={quote.provider}
                onChange={async (provider) => {
                  const next = quotes.find(
                    (candidate) => candidate.provider === provider
                  );
                  if (!next) return;
                  setQuote(next);
                  try {
                    await refreshAllowance(next);
                  } catch (e: any) {
                    setError(e?.message || String(e));
                  }
                }}
                options={quotes.map((candidate) => ({
                  value: candidate.provider,
                  label: `${candidate.provider} — ${ethers.utils.formatUnits(
                    candidate.amountOut,
                    toToken.decimals
                  )} ${toToken.symbol}`,
                }))}
              />
            </div>
            <div className="flex justify-between">
              <span>Receive</span>
              <strong className="text-r-neutral-title-1">
                {outputAmount} {toToken.symbol}
              </strong>
            </div>
            <div className="mt-[6px] flex justify-between">
              <span>Route</span>
              <span>{quote.provider} via LlamaSwap</span>
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
            <div className="mt-[6px] flex justify-between">
              <span>Estimated gas</span>
              <span>{quote.estimatedGas}</span>
            </div>
            <div className="mt-[8px] text-[11px] text-r-neutral-foot">
              Compared: {quote.providersCompared.join(', ')}. Only routes that
              pass provider-specific target, calldata, recipient, amount,
              slippage, value, and fee validation are shown.
            </div>
            {quote.permit2 ? (
              <div className="mt-[8px] text-[11px] text-r-neutral-foot">
                This Matcha route requires a one-time Permit2 authorization
                signature after exact token approval.
              </div>
            ) : null}
          </div>
        ) : null}

        {!quote ? (
          <Button block type="primary" loading={loading} onClick={fetchQuote}>
            Compare validated routes
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
