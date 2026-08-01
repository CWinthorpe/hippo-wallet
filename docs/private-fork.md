# Hippo Wallet privacy and trust boundary

Hippo Wallet is a downstream Rabby Wallet build intended for direct inspection and self-hosted use. It operates no Hippo telemetry collector, RPC relay, swap relay or account backend.

This document describes release `0.93.102-hippo.3`.

## Fail-closed Rabby/DeBank policy

Hippo stores one extension-local policy with independent permissions for:

- Portfolio, token and DeFi data
- History
- NFT viewing and metadata
- Enhanced signing analysis
- Approval discovery
- Security and reputation checks
- Dapp discovery
- Feedback

The initial policy state is `unconfigured`, which is operationally deny-all. The same rule applies to an upgraded installation with no valid saved policy. Before configuration:

- Rabby/DeBank requests are rejected before transport.
- Rejected calls are not queued for later delivery.
- No provider identifiers are generated.
- Rabby/DeBank remote media is blocked by dynamic declarative rules.
- Normal wallet routes do not mount; the privacy screen is shown first.

The user can save an all-disabled policy and continue in local/RPC-only mode. Enabling a category does not initiate a request. Disabling access takes effect without restarting the extension, clears provider-derived caches for the current account and removes the category's contact log.

Endpoint classification is performed at the shared Axios/fetch adapter used by the Rabby API clients. Known removed endpoints always fail. Unknown or unclassified Rabby/DeBank endpoints also fail. Direct feedback image upload is routed through the same policy rather than bypassing the adapter from the UI.

The settings page records the provider hostname and last attempted contact time for each enabled category. These records stay in extension-local storage and can be cleared. Privacy choices are not synchronized and are not reported.

## Removed telemetry

The production build retains these controls from earlier Hippo releases:

- Statistics adapters are local no-ops.
- GA4 and Matomo helpers do not transmit events.
- Sentry is not initialized in the UI or service worker.
- Uninstall reporting is reset to an empty URL.
- Rating prompts and tracking opt-ins are removed.
- Persisted Rabby API installation identifiers are cleared and write-blocked.
- Automatic transaction, message and typed-data action logging is removed.
- Declarative rules block known analytics, crash, uninstall, action-log and disabled Rabby RPC-control-plane destinations.

## Retained optional disclosure

After explicit permission, a retained service may receive the following:

- **Portfolio/history/NFT/DeFi:** wallet address, chain, requested asset or protocol, currency and pricing context.
- **Enhanced signing analysis:** origin, wallet, chain, destination, value, calldata, message or typed-data contents.
- **Approval discovery:** wallet address and chain. Remote results are discovery hints; current ERC-20 allowances and NFT approval state must be checked through the selected RPC before use.
- **Security/dapp discovery:** origin, address, contract or search context needed for the requested lookup.
- **Feedback:** text and deliberately attached screenshots.

These payloads are not made anonymous by Hippo. A VPN can hide the residential IP from a provider, but not wallet addresses, origins, calldata, typed data or token interests contained in the request.

## Removed backend-dependent products

The release removes the routes, services, startup hooks, polling loops, dependencies, assets and locale trees for:

- Gas accounts, gasless and sponsored submission
- Points, badges, referrals, gifts, campaigns and ecosystem promotions
- Perpetual trading, Hyperliquid and its floating widget
- Every bridge implementation
- NFT listing, offer, sale and marketplace execution
- Specialized staking and faucets
- Rabby swap adapters, fee collection and trade reporting
- Backend transaction-broadcast status watching

Gas-account and gasless fields remain only where necessary to reject stale or migrated approval state. The provider controller refuses them before signing or submission.

The retained generated Rabby API client includes legacy method names and endpoint strings for removed products because it also supplies optional retained APIs. `remoteDataPolicy.ts` marks those endpoint families as removed, and the shared adapter refuses them before constructing a network request.

## RPC control plane

Hippo does not call Rabby's `/v1/chainrpc` routing endpoint and does not use `/v1/wallet/eth_rpc`. Both methods are disabled in the API client and blocked by MV3 declarative rules.

A reviewed provider map is bundled at `src/constant/default-rpc-providers.json`.

### Route precedence

With a custom profile:

1. Custom primary RPC.
2. Custom fallback RPCs for replay-safe reads and estimates.
3. Custom broadcast URL, or the primary URL if no broadcast URL is set.

Without a custom profile:

1. 1RPC.
2. dRPC.
3. PublicNode.
4. 0xRPC.

Fallback is sequential and limited to replay-safe reads and estimates. Transport errors, selected quota/rate-limit responses, selected server failures and malformed results may advance to the next read endpoint. Semantic failures do not.

Gas data is derived from the selected RPC using fee history, priority fee, latest-block base fee, gas price and gas estimation. There is no centralized gas API fallback.

The bundled map covers 67 of 86 integrated networks. These 19 networks require a custom RPC: Oasys, Conflux, Story, Reya, Botanix, Citrea, IoTeX, BounceBit, Cyber, Etherlink, Zircuit, Sophon, DFK Chain, Chiliz, Mitosis, Taiko, Bitlayer, DBK Chain and Plasma.

## Raw-transaction submission

Every signed raw transaction attempt has one destination:

- A configured custom broadcast RPC takes precedence.
- Eligible ordinary Ethereum Mainnet transactions use `https://rpc.mevblocker.io/fullprivacy`.
- Other transactions use the first selected ordinary RPC.

Hippo computes the local transaction hash before submission and compares it with the returned hash. A timeout, disconnect, malformed hash or mismatched hash is treated as potentially ambiguous. Hippo does not automatically rebroadcast to another provider. External signers such as WalletConnect or Coinbase may control their own broadcast behavior.

## LlamaSwap boundary

Same-chain swap quotes are requested directly from `https://swap-api.defillama.com/dexAggregatorQuote` using the public credential shipped by LlamaSwap's frontend. Hippo currently selects the KyberSwap adapter and sends the chain, token addresses, raw input amount, recipient and requested slippage.

The response is treated as untrusted. Hippo validates:

- Supported chain
- Input/output token addresses
- Exact input and quoted output amounts
- Recipient presence in calldata
- Allowlisted approval spender and router
- Transaction target, calldata shape and native value
- Slippage bounds and calculated minimum output
- Absence of an extra route cost

ERC-20 approvals are exact-amount approvals. Quotes are refreshed before submission and a quote below the prior minimum is rejected. Swap records stay in extension-local storage.

The frontend endpoint is not a stable documented integration contract. Schema changes, credential changes or anti-bot controls can break swaps. Hippo fails closed rather than changing providers silently.

## Provider caveats

Privacy descriptions are provider claims, not independent attestations:

- 1RPC publishes a zero-tracking design.
- dRPC's privacy policy permits temporary IP processing/logging for routing and rate limiting.
- PublicNode states that operational IP data may be retained for up to 24 hours.
- 0xRPC states that it does not log raw IP addresses.
- MEV Blocker receives signed raw Ethereum transactions submitted to it.
- LlamaSwap receives deliberate quote parameters.

Public endpoints have quotas and may change method support without notice. No paid RPC credential or Hippo server credential is embedded.

## Release verification

A release is incomplete until the built MV3 artifact has passed:

- TypeScript and ESLint checks
- Focused policy, RPC, gas and LlamaSwap tests
- Full Jest suite
- Production MV3 build
- ZIP integrity and SHA-256 verification
- Manifest, branding and removed-feature scans
- Source-map and embedded source-map scans
- Fresh-profile Chromium load
- First-run deny-all network trace
- Per-capability allowlist traces
- Signed-broadcast destination and call-count checks

The GitHub release must publish the tested ZIP and its matching SHA-256 digest.

## License and provenance

Hippo Wallet remains a Rabby Wallet derivative. Upstream notices, dependency attributions and the original license remain applicable. See `LICENSE`, `NOTICE` and the repository history.
