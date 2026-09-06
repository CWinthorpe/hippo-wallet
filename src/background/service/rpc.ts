import { CHAINS_ENUM } from '@debank/common';
import { createPersistStore } from 'background/utils';
import { findChain, findChainByEnum } from '@/utils/chain';
import { http } from '../utils/http';
import { CUSTOM_RPC_ENABLED } from '@/constant';
import { keccak256 } from 'viem';
import {
  BuiltInDefaultRPC,
  getBuiltInDefaultRPCMap,
} from '@/constant/default-rpc-providers';

export interface RPCItem {
  /** Primary read/estimate endpoint. */
  url: string;
  /** Ordered read/estimate fallbacks. Never used for signed broadcast. */
  fallbackUrls?: string[];
  /** Optional single-purpose signed transaction endpoint. */
  broadcastUrl?: string;
  enable: boolean;
}

type RPCDefaultItem = BuiltInDefaultRPC;

export type RPCServiceStore = {
  customRPC: Record<string, RPCItem>;
  defaultRPC?: Record<string, RPCDefaultItem>;
};

export type CustomRPCServiceStore = Pick<RPCServiceStore, 'customRPC'>;

const READ_FALLBACK_METHODS = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_chainId',
  'eth_createAccessList',
  'eth_estimateGas',
  'eth_feeHistory',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'net_listening',
  'net_peerCount',
  'net_version',
  'web3_clientVersion',
  'web3_sha3',
  'debug_traceCall',
  'trace_call',
]);

const STATEFUL_RPC_METHODS = new Set([
  'eth_getFilterChanges',
  'eth_getFilterLogs',
  'eth_getWork',
  'eth_newBlockFilter',
  'eth_newFilter',
  'eth_newPendingTransactionFilter',
  'eth_uninstallFilter',
]);

const HEX_QUANTITY_RESULT_METHODS = new Set([
  'eth_blockNumber',
  'eth_chainId',
  'eth_estimateGas',
  'eth_gasPrice',
  'eth_getBalance',
  'eth_getBlockTransactionCountByHash',
  'eth_getBlockTransactionCountByNumber',
  'eth_getTransactionCount',
  'eth_getUncleCountByBlockHash',
  'eth_getUncleCountByBlockNumber',
  'eth_hashrate',
  'eth_maxPriorityFeePerGas',
  'net_peerCount',
]);

const HEX_DATA_RESULT_METHODS = new Set([
  'eth_call',
  'eth_getCode',
  'eth_getStorageAt',
]);

const ARRAY_RESULT_METHODS = new Set([
  'eth_accounts',
  'eth_getLogs',
  'eth_getWork',
]);

const INVALID_RPC_RESULT_CODE = 'INVALID_RPC_RESULT';
export const MEV_BLOCKER_FULL_PRIVACY_RPC =
  'https://rpc.mevblocker.io/fullprivacy';

const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_RPC_CODES = new Set([-32603, -32001, -32005, -32016]);
const RETRYABLE_NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ETIMEDOUT',
]);

const uniqueUrls = (urls: Array<string | undefined>) => {
  const seen = new Set<string>();
  return urls.reduce<string[]>((result, value) => {
    const url = value?.trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      result.push(url);
    }
    return result;
  }, []);
};

export const normalizeRPCItem = (item: RPCItem): RPCItem => {
  const [url = ''] = uniqueUrls([item.url]);
  const fallbackUrls = uniqueUrls(item.fallbackUrls || []).filter(
    (fallback) => fallback !== url
  );
  const [broadcastUrl] = uniqueUrls([item.broadcastUrl]);

  return {
    url,
    enable: item.enable !== false,
    ...(fallbackUrls.length ? { fallbackUrls } : {}),
    ...(broadcastUrl ? { broadcastUrl } : {}),
  };
};

export const canUseReadFallback = (method: string) => {
  if (STATEFUL_RPC_METHODS.has(method)) {
    return false;
  }
  return READ_FALLBACK_METHODS.has(method) || method.startsWith('eth_get');
};

export const isRetryableRPCError = (error: any) => {
  const status = Number(error?.response?.status ?? error?.status);
  if (RETRYABLE_HTTP_STATUSES.has(status)) {
    return true;
  }

  const code =
    error?.code ??
    error?.error?.code ??
    error?.response?.data?.error?.code ??
    error?.cause?.code;
  if (code === INVALID_RPC_RESULT_CODE) {
    return true;
  }
  const message = [
    error?.message,
    error?.error?.message,
    error?.response?.data?.error?.message,
    error?.details,
    error?.cause?.message,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (
    /(?:execution reverted|contract logic error|always failing transaction|gas required exceeds allowance|unpredictable gas limit|invalid params?|invalid argument|method not found|insufficient funds|nonce too (?:low|high)|already known|replacement transaction underpriced|transaction underpriced|intrinsic gas too low|invalid sender)/i.test(
      message
    )
  ) {
    return false;
  }
  const numericCode =
    typeof code === 'number'
      ? code
      : typeof code === 'string' && /^-?\d+$/.test(code.trim())
      ? Number(code)
      : undefined;
  if (numericCode !== undefined && RETRYABLE_RPC_CODES.has(numericCode)) {
    return true;
  }
  if (
    typeof code === 'string' &&
    RETRYABLE_NETWORK_CODES.has(code.toUpperCase())
  ) {
    return true;
  }

  return /(?:timed?\s*out|timeout|network error|failed to fetch|fetch failed|socket hang up|econn(?:reset|refused)|rate.?limit|too many requests|temporarily unavailable|service unavailable|bad gateway|gateway timeout|overloaded)/i.test(
    message
  );
};

const rpcIdentity = (url: string) => {
  try {
    return new URL(url).origin;
  } catch {
    return 'invalid-rpc-url';
  }
};

const invalidRPCResult = (method: string, url: string) =>
  Object.assign(
    new Error(`Invalid ${method} result from ${rpcIdentity(url)}`),
    { code: INVALID_RPC_RESULT_CODE }
  );

export const validateRPCResult = (method: string, result: any, url: string) => {
  if (
    method === 'eth_sendRawTransaction' &&
    (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result))
  ) {
    throw new Error(`Invalid transaction hash from ${rpcIdentity(url)}`);
  }
  if (canUseReadFallback(method) && result === undefined) {
    throw invalidRPCResult(method, url);
  }
  if (
    HEX_QUANTITY_RESULT_METHODS.has(method) &&
    (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result))
  ) {
    throw invalidRPCResult(method, url);
  }
  if (
    HEX_DATA_RESULT_METHODS.has(method) &&
    (typeof result !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(result))
  ) {
    throw invalidRPCResult(method, url);
  }
  if (ARRAY_RESULT_METHODS.has(method) && !Array.isArray(result)) {
    throw invalidRPCResult(method, url);
  }
  return result;
};

export async function callWithFallbackRpcs<T>(
  rpcUrls: string[],
  fn: (rpc: string) => Promise<T>
): Promise<T> {
  let firstError: unknown;
  for (let index = 0; index < rpcUrls.length; index++) {
    const url = rpcUrls[index];
    try {
      return await fn(url);
    } catch (error) {
      firstError ??= error;
      const hasFallback = index < rpcUrls.length - 1;
      if (!hasFallback || !isRetryableRPCError(error)) {
        throw error;
      }
      console.warn(`RPC unavailable: ${rpcIdentity(url)}; trying fallback`);
    }
  }
  throw firstError;
}

const MAX = 4_294_967_295;
let idCounter = Math.floor(Math.random() * MAX);

function getUniqueId(): number {
  idCounter = (idCounter + 1) % MAX;
  return idCounter;
}

export class RPCService {
  store: RPCServiceStore = {
    customRPC: {},
    defaultRPC: {},
  };
  rpcStatus: Record<
    string,
    {
      expireAt: number;
      available: boolean;
    }
  > = {};
  routingVersion = 0;

  init = async () => {
    const storage = await createPersistStore<RPCServiceStore>({
      name: 'rpc',
      template: {
        customRPC: {},
        defaultRPC: {},
      },
    });
    this.store = storage || this.store;

    let changed = false;
    Object.entries({ ...this.store.customRPC }).forEach(
      ([chainEnum, value]) => {
        if (!findChainByEnum(chainEnum)) {
          changed = true;
          delete this.store.customRPC[chainEnum];
          return;
        }

        const normalized = normalizeRPCItem(value);
        if (JSON.stringify(normalized) !== JSON.stringify(value)) {
          changed = true;
          this.store.customRPC[chainEnum] = normalized;
        }
      }
    );

    if (changed) {
      this.store.customRPC = { ...this.store.customRPC };
    }

    await this.syncDefaultRPC();
  };

  syncDefaultRPC = async () => {
    this.store.defaultRPC = getBuiltInDefaultRPCMap();
    this.routingVersion++;
  };

  getDefaultRPCByChainServerId = (chainServerId: string) => {
    return this.store.defaultRPC?.[chainServerId];
  };

  defaultRPCRequest = async (
    host: string,
    method: string,
    params: any[],
    timeout = 10000
  ) => {
    const { data } = await http.post(
      host,
      {
        jsonrpc: '2.0',
        id: getUniqueId(),
        params,
        method,
      },
      { timeout }
    );
    if (data?.error) throw data.error;
    return validateRPCResult(method, data.result, host);
  };

  /**
   * Historical name retained for callers. Broadcast deliberately uses one
   * endpoint only; failure is surfaced instead of leaking the raw transaction
   * to another relay.
   */
  defaultRPCSubmitTxWithFallback = async (
    chainServerId: string,
    method: string,
    params: any[]
  ): Promise<[any, string]> => {
    const host = this.store.defaultRPC?.[chainServerId]?.rpcUrl?.[0];
    if (!host) {
      throw new Error(
        `No built-in privacy RPC is available for ${chainServerId}. Configure a custom RPC for this network.`
      );
    }
    const result = await this.defaultRPCRequest(host, method, params);
    return [validateRPCResult(method, result, host), host];
  };

  submitRawTransaction = async ({
    chain,
    chainServerId,
    rawTx,
    allowMevBlocker,
  }: {
    chain: CHAINS_ENUM;
    chainServerId: string;
    rawTx: `0x${string}`;
    allowMevBlocker: boolean;
  }) => {
    const localTransactionHash = keccak256(rawTx);
    let endpoint = '';

    try {
      let hash: string;
      if (this.hasCustomRPC(chain)) {
        const rpc = this.getRPCByChain(chain)!;
        endpoint = rpc.broadcastUrl || rpc.url;
        hash = await this.requestCustomRPC(chain, 'eth_sendRawTransaction', [
          rawTx,
        ]);
      } else if (chain === CHAINS_ENUM.ETH && allowMevBlocker) {
        endpoint = MEV_BLOCKER_FULL_PRIVACY_RPC;
        hash = await this.defaultRPCRequest(
          endpoint,
          'eth_sendRawTransaction',
          [rawTx]
        );
      } else {
        endpoint = this.store.defaultRPC?.[chainServerId]?.rpcUrl?.[0] || '';
        if (!endpoint) {
          throw new Error(
            `No built-in privacy RPC is available for ${chainServerId}. Configure a custom RPC for this network.`
          );
        }
        hash = await this.defaultRPCRequest(
          endpoint,
          'eth_sendRawTransaction',
          [rawTx]
        );
      }

      if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
        const malformed = new Error(
          `RPC returned a malformed transaction hash. Local hash: ${localTransactionHash}`
        ) as Error & Record<string, any>;
        malformed.code = 'RAW_TX_RESULT_INVALID';
        malformed.ambiguousSubmission = true;
        malformed.localTransactionHash = localTransactionHash;
        malformed.submissionEndpoint = endpoint;
        throw malformed;
      }

      if (hash.toLowerCase() !== localTransactionHash.toLowerCase()) {
        const mismatch = new Error(
          `RPC returned a transaction hash that does not match the signed transaction. Local hash: ${localTransactionHash}`
        ) as Error & Record<string, any>;
        mismatch.code = 'RAW_TX_HASH_MISMATCH';
        mismatch.ambiguousSubmission = true;
        mismatch.localTransactionHash = localTransactionHash;
        mismatch.submissionEndpoint = endpoint;
        throw mismatch;
      }

      return {
        hash,
        localTransactionHash,
        submissionEndpoint: endpoint,
        usedMevBlocker: endpoint === MEV_BLOCKER_FULL_PRIVACY_RPC,
      };
    } catch (error: any) {
      if (
        error?.code === 'RAW_TX_HASH_MISMATCH' ||
        error?.code === 'RAW_TX_RESULT_INVALID'
      ) {
        throw error;
      }
      const wrapped =
        error instanceof Error ? error : new Error(String(error || ''));
      Object.assign(wrapped, {
        localTransactionHash,
        submissionEndpoint: endpoint,
        ambiguousSubmission: isRetryableRPCError(error),
      });
      throw wrapped;
    }
  };

  requestDefaultRPC = async ({
    chainServerId,
    method,
    params,
  }: {
    chainServerId: string;
    method: string;
    params: any;
    origin?: string;
  }) => {
    const hostList = this.store.defaultRPC?.[chainServerId]?.rpcUrl || [];
    if (!hostList.length) {
      const error = new Error(
        `No built-in privacy RPC is available for ${chainServerId}. Configure a custom RPC for this network.`
      );
      (error as Error & { code?: string }).code = 'NO_BUILT_IN_RPC';
      throw error;
    }

    if (canUseReadFallback(method)) {
      return callWithFallbackRpcs(hostList, (rpc) =>
        this.defaultRPCRequest(rpc, method, params)
      );
    }

    return this.defaultRPCRequest(hostList[0], method, params);
  };

  getDefaultRPC = (chainServerId: string) => {
    return this.store.defaultRPC?.[chainServerId];
  };

  /**
   * Custom-RPC-first selector for replay-safe READS (receipts, gas, quotes).
   * User custom RPC wins (Hippo invariant); built-in privacy providers are
   * used only when no custom RPC is enabled for that chain. Background
   * receipt polling MUST go through this instead of requestDefaultRPC so a
   * transaction submitted through the user's endpoint is not subsequently
   * looked up through an endpoint the user explicitly bypassed.
   */
  requestReadRPC = async ({
    chainServerId,
    method,
    params,
  }: {
    chainServerId: string;
    method: string;
    params: any[];
  }) => {
    const chainItem = findChain({ serverId: chainServerId });
    if (chainItem && this.hasCustomRPC(chainItem.enum)) {
      return this.requestCustomRPC(chainItem.enum, method, params);
    }
    return this.requestDefaultRPC({ chainServerId, method, params });
  };

  hasCustomRPC = (chain: CHAINS_ENUM) => {
    return Boolean(
      CUSTOM_RPC_ENABLED &&
        this.store.customRPC[chain] &&
        this.store.customRPC[chain].enable
    );
  };

  getRPCByChain = (chain: CHAINS_ENUM): RPCItem | undefined => {
    return CUSTOM_RPC_ENABLED ? this.store.customRPC[chain] : undefined;
  };

  getAllRPC = (): Record<string, RPCItem> => {
    return CUSTOM_RPC_ENABLED ? this.store.customRPC : {};
  };

  getCustomRPCStore = (): CustomRPCServiceStore => ({
    customRPC: this.getAllRPC(),
  });

  /**
   * Merge a partial store from the UI (`setStorageItem('rpc', ...)`). The
   * proxied store persists and broadcasts every assignment; only customRPC
   * writes clear the routing/probe cache and report changed chains so the
   * caller can re-sync custom-testnet RPCs.
   */
  patchStore = (partials: Partial<RPCServiceStore>): CHAINS_ENUM[] => {
    const previousCustomRPC = this.store.customRPC;
    if (Object.prototype.hasOwnProperty.call(partials, 'defaultRPC')) {
      this.store.defaultRPC = partials.defaultRPC;
    }
    if (!Object.prototype.hasOwnProperty.call(partials, 'customRPC')) {
      return [];
    }
    this.store.customRPC = {
      ...this.store.customRPC,
      ...partials.customRPC,
    };
    const changedChains = Object.keys({
      ...previousCustomRPC,
      ...this.store.customRPC,
    }).filter((chain) => {
      const previous = previousCustomRPC[chain];
      const current = this.store.customRPC[chain];
      return (
        previous?.url !== current?.url || previous?.enable !== current?.enable
      );
    }) as CHAINS_ENUM[];
    changedChains.forEach((chain) => {
      delete this.rpcStatus[chain];
      this.routingVersion++;
    });
    return changedChains;
  };

  getRoutingVersion = () => this.routingVersion;

  setRPC = (
    chain: CHAINS_ENUM,
    url: string,
    fallbackUrls: string[] = [],
    broadcastUrl?: string
  ) => {
    if (!CUSTOM_RPC_ENABLED) return;
    const existing = this.store.customRPC[chain];
    const rpcItem = normalizeRPCItem({
      url,
      fallbackUrls,
      broadcastUrl,
      enable: existing?.enable ?? true,
    });
    this.store.customRPC = {
      ...this.store.customRPC,
      [chain]: rpcItem,
    };
    delete this.rpcStatus[chain];
    this.routingVersion++;
  };

  setRPCEnable = (chain: CHAINS_ENUM, enable: boolean) => {
    if (!CUSTOM_RPC_ENABLED || !this.store.customRPC[chain]) return;
    this.store.customRPC = {
      ...this.store.customRPC,
      [chain]: {
        ...this.store.customRPC[chain],
        enable,
      },
    };
    delete this.rpcStatus[chain];
    this.routingVersion++;
  };

  removeCustomRPC = (chain: CHAINS_ENUM) => {
    if (!CUSTOM_RPC_ENABLED) return;
    const { [chain]: _removed, ...customRPC } = this.store.customRPC;
    this.store.customRPC = customRPC;
    delete this.rpcStatus[chain];
    this.routingVersion++;
  };

  requestCustomRPC = async (
    chain: CHAINS_ENUM,
    method: string,
    params: any[],
    timeout?: number
  ) => {
    if (!CUSTOM_RPC_ENABLED) {
      throw new Error('Custom RPC is disabled');
    }
    const item = this.store.customRPC[chain];
    if (!item?.url) {
      throw new Error(`No custom RPC set for ${chain}`);
    }
    const requestHost = async (host: string) => {
      const result =
        timeout === undefined
          ? await this.request(host, method, params)
          : await this.request(host, method, params, timeout);
      return validateRPCResult(method, result, host);
    };

    if (method === 'eth_sendRawTransaction') {
      const broadcastHost = item.broadcastUrl || item.url;
      return requestHost(broadcastHost);
    }

    if (!canUseReadFallback(method)) {
      return requestHost(item.url);
    }

    const hosts = uniqueUrls([item.url, ...(item.fallbackUrls || [])]);
    return callWithFallbackRpcs(hosts, requestHost);
  };

  request = async (
    host: string,
    method: string,
    params: any[],
    timeout = 10000
  ) => {
    const { data } = await http.post(
      host,
      {
        jsonrpc: '2.0',
        id: getUniqueId(),
        params,
        method,
      },
      { timeout }
    );
    if (data?.error) throw data.error;
    const hasResult =
      data && Object.prototype.hasOwnProperty.call(data, 'result');
    const isMalformedEnvelope =
      data &&
      typeof data === 'object' &&
      !hasResult &&
      ('jsonrpc' in data || 'id' in data);
    const result = hasResult
      ? data.result
      : isMalformedEnvelope
      ? undefined
      : data;
    return validateRPCResult(method, result, host);
  };

  ping = async (chain: CHAINS_ENUM) => {
    if (!CUSTOM_RPC_ENABLED) return false;
    if (this.rpcStatus[chain]?.expireAt > Date.now()) {
      return this.rpcStatus[chain].available;
    }
    if (!this.store.customRPC[chain]?.url) return false;
    try {
      await this.requestCustomRPC(chain, 'eth_blockNumber', [], 2000);
      this.rpcStatus = {
        ...this.rpcStatus,
        [chain]: {
          expireAt: Date.now() + 60 * 1000,
          available: true,
        },
      };
      return true;
    } catch (e) {
      this.rpcStatus = {
        ...this.rpcStatus,
        [chain]: {
          expireAt: Date.now() + 60 * 1000,
          available: false,
        },
      };
      return false;
    }
  };
}

export default new RPCService();
