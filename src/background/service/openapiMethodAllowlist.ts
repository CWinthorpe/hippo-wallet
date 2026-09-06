/**
 * Explicit retained-method allowlists for the UI-facing OpenAPI namespaces
 * (gpt56 round-3 blocker B4).
 *
 * The UI wallet proxies `wallet.openapi.<method>` and
 * `wallet.fakeTestnetOpenapi.<method>` into the background, which used to
 * dispatch ANY method name that happened to exist on the service objects.
 * That made retired relayer APIs (`withdrawTx`, `retryPushTx`) dynamically
 * reachable even with zero static UI callers — reaching the retired API
 * boundary and relying on a later RemoteDataPolicy exception is not removal.
 *
 * Dispatch is now deny-by-default: a call only executes when the method is
 * named here. The lists were collected from the real call surface of this
 * repository (static `.openapi.<method>` usages, `apiProvider.<method>`
 * usages of the security-engine/action data loaders, and the fake-testnet
 * surface implemented in customTestnet.ts). Adding a method here is a
 * deliberate, reviewable act; a retired method must never appear.
 */

export type WalletNamespaceKind = 'openapi' | 'fakeTestnetOpenapi';

/** Methods the UI may invoke through `wallet.openapi.*`. */
export const RETAINED_OPENAPI_METHODS: ReadonlySet<string> = new Set([
  // dapp/asset/protocol browse + search
  'addrDesc',
  'approvalStatus',
  'checkCex',
  'collectionList',
  'customListToken',
  'depositCexSupport',
  'getAppChainList',
  'getCexSupportList',
  'getChainList',
  'getChainListByIds',
  'getComplexProtocolList',
  'getContractInfo',
  'getDappHotTags',
  'getDappsInfo',
  'getHistoryProtocol',
  'getLatestVersion',
  'getOfflineChainList',
  'getOriginPopularityLevel',
  'getOriginThirdPartyCollectList',
  'getProtocol',
  'getRecommendChains',
  'getSummarizedAssetList',
  'getSwapTokenList',
  'getToken',
  'getTokenDatePrice',
  'getTokenEntity',
  'getTokenPriceCurve',
  'getTotalBalance',
  'getTxRequests',
  'getUserFeedbackList',
  'hasInteraction',
  'hasTransfer',
  'hasTransferAllChain',
  'historyGasUsed',
  'isBlockedAddress',
  'listTxHisotry',
  'mempoolChecks',
  'parseCommon',
  'parseText',
  'parseTx',
  'parseTypedData',
  'preExecTx',
  'searchChainList',
  'searchDapp',
  'searchToken',
  'searchTokensV2',
  'submitFeedback',
  'tokenAuthorizedList',
  'tokenPrice',
  'usedChainList',
  'userNFTAuthorizedList',
  'walletSupportOrigin',
  'walletSupportSelector',
  // custom OpenAPI host management (AdvanceSettings)
  'getHost',
  'setHost',
]);

/** Methods the UI may invoke through `wallet.fakeTestnetOpenapi.*`. */
export const RETAINED_FAKE_TESTNET_OPENAPI_METHODS: ReadonlySet<string> = new Set(
  [
    'getToken',
    'getContractInfo',
    'addrDesc',
    'hasTransfer',
    'hasInteraction',
    'isTokenContract',
    'depositCexSupport',
    'addrUsedChainList',
    'checkSpoofing',
  ]
);

/**
 * Deny-by-default namespace dispatch. Returns null when the method is not
 * retained; callers must surface an explicit rejection error naming the
 * method — never "whatever exists".
 */
export const resolveRetainedNamespaceMethod = (
  namespace: 'openapi' | 'fakeTestnetOpenapi',
  method: unknown
): string | null => {
  const name = typeof method === 'string' ? method : '';
  if (!name || name === 'then') return null;
  const allowlist =
    namespace === 'openapi'
      ? RETAINED_OPENAPI_METHODS
      : RETAINED_FAKE_TESTNET_OPENAPI_METHODS;
  return allowlist.has(name) ? name : null;
};

export const openapiMethodRejectedError = (
  namespace: string,
  method: unknown
) =>
  new Error(
    `OpenAPI method rejected by Hippo allowlist: ${namespace}.${String(method)}`
  );

/**
 * The single executable dispatch used by the background port handler. A
 * request executes only when (a) the method is retained by the allowlist and
 * (b) the namespace actually exposes it; anything else throws an explicit
 * rejection. There is deliberately no fallback to dynamic lookup — this
 * function is the whole dispatch decision, so tests can pin the real
 * behavior instead of grepping the call site.
 */
export const dispatchRetainedNamespaceCall = (
  namespaceKind: WalletNamespaceKind,
  namespaceObject: unknown,
  method: unknown,
  params: unknown[]
): unknown => {
  const retained = resolveRetainedNamespaceMethod(namespaceKind, method);
  if (!retained) {
    throw openapiMethodRejectedError(namespaceKind, method);
  }
  const target = (namespaceObject as
    | Record<string, unknown>
    | null
    | undefined)?.[retained];
  if (typeof target !== 'function') {
    throw openapiMethodRejectedError(namespaceKind, method);
  }
  return (target as (...args: unknown[]) => unknown)(...params);
};
