/**
 * Remote Rabby/DeBank endpoints whose product surface was deliberately
 * removed from Hippo Wallet (relayer/gas-account sponsored submission,
 * points/badges, bridges, staking, faucets, Rabby/LlamaSwap aggregation,
 * NFT trading, hidden telemetry/RPC relays, Rabby gas-price feeds).
 *
 * Kept in a dependency-free module so BOTH the background policy
 * (`remoteDataPolicy.ts`) and the node-environment retired-surface
 * regression (`__tests__/background/retiredRelayerIsolation.test.ts`) can
 * import it without pulling browser polyfills into the test graph.
 *
 * Rules of engagement:
 * - Requests matching any pattern are denied `REMOTE_FEATURE_REMOVED` even
 *   when the corresponding capability is granted.
 * - The allowlist must map NO retained OpenAPI method onto one of these
 *   paths (mechanically enforced by the regression).
 * - Do NOT add token variants that spell removed endpoint paths whose
 *   retired client constructors Hippo has already deleted from the
 *   packaged runtime (for example the historical per-tx gas-usage report):
 *   the bare path tokens would ship inside background.js and weaken the
 *   artifact-level zero-marker scan. Such paths stay blocked fail-closed as
 *   UNCLASSIFIED requests instead (`assertRequestAllowed` denies anything
 *   not explicitly capability-classified).
 */
export const REMOVED_ENDPOINT_PATTERNS: ReadonlyArray<RegExp> = [
  /^\/v\d+\/points(?:\/|$)/,
  /^\/v\d+\/badge(?:\/|$)/,
  /^\/v\d+\/(?:wallet\/)?gas_account(?:\/|$)/,
  /^\/v\d+\/(?:wallet\/)?gas_station(?:\/|$)/,
  /^\/v\d+\/bridge(?:\/|$)/,
  /^\/v\d+\/user\/dbk\/bridge_/,
  /^\/v\d+\/staking(?:\/|$)/,
  /^\/v\d+\/faucet(?:\/|$)/,
  /^\/v\d+\/wallet\/(?:tx_is_gasless|txs_is_gasless|submit_tx|push_tx|withdraw_tx|retry_push_tx|supported_push_type)(?:\/|$)/,
  /^\/v\d+\/wallet\/(?:gas_market|gas_price_stats|estimate_gas)(?:\/|$)/,
  /^\/v\d+\/wallet\/(?:swap_quote|swap_dex_list|supported_dex_list|swap_trade|swap_trade_list|check_slippage|suggest_slippage)(?:\/|$)/,
  /^\/v\d+\/nft\/(?:trading_config|order|fee)(?:\/|$)/,
  /^\/v\d+\/token\/hyperliquid_/,
  /^\/v\d+\/user\/has_hyperliquid_permission$/,
  /^\/v\d+\/engine\/action\/log$/,
  /^\/v\d+\/chainrpc$/,
  /^\/v\d+\/wallet\/eth_rpc$/,
];
