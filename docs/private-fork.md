# Hippo Wallet privacy and trust boundary

Hippo Wallet is a downstream Rabby Wallet build intended for direct inspection and self-hosted use. It operates no Hippo telemetry collector, RPC relay, swap relay or account backend.

This document describes release `0.93.104-hippo.7`.

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

- Rabby gas accounts, Rabby-relayed gasless paths and sponsored submission
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

## WalletConnect boundary

WalletConnect uses Hippo's own public Reown project ID and Hippo-branded client
metadata. Pairing and session traffic reaches the WalletConnect/Reown relay only
after the user opens and uses the WalletConnect flow. Release builds do not use
Rabby's Reown project identity. Operators can rotate the public client ID with
the `WALLETCONNECT_PROJECT_ID` build environment variable.

## CoW Protocol boundary

Hippo uses CoW Protocol as its only swap execution system. Same-chain quotes go directly to the documented production order-book API under `https://api.cow.fi/<network>/api/v1`; no Hippo proxy, intermediary aggregator, embedded credential, referral fee or Rabby trade endpoint is involved. Supported production networks are Ethereum, BNB Chain, Gnosis Chain, Polygon, Base, Plasma, Arbitrum One, Avalanche, Ink and Linea. Cross-chain and bridge paths remain removed.

The exact network API base comes from pinned CoW SDK configuration. The transport accepts only HTTPS requests to an approved production network and only these routes:

- `POST /api/v1/quote`
- `POST /api/v1/orders`
- `GET /api/v1/orders/<56-byte-order-uid>`
- `DELETE /api/v1/orders`

It sends fixed JSON headers with `credentials: omit`, `referrerPolicy: no-referrer`, `cache: no-store` and `redirect: error`. Caller headers, cookies, query strings, fragments, redirects and arbitrary paths are rejected. Request bodies, deadlines, declared response sizes and streamed response bytes are bounded. Successful non-JSON responses fail closed.

The selected RPC supplies token code, decimals, symbol, account balance, protocol-contract code and transaction gas estimates. A quote request binds the exact sell amount, sell/buy tokens, account/receiver, sell order kind, EIP-712 or EthFlow signing scheme, ERC-20 balance source, ten-minute validity, full app-data document and its Keccak-256 hash. The response must preserve those fields, be marked verified, remain inside the accepted validity window, and reconcile the quoted network fee with the exact pre-fee sell amount. Hippo applies CoW's published sell-order slippage formula locally—subtracting the floored slippage amount from the post-fee buy amount—exactly once, and signs fee amount zero as required by the current order model.

ERC-20 input orders use CoW's fixed Vault Relayer and Settlement contracts. Hippo grants only the exact sell amount; a nonzero insufficient allowance is reset before the exact approval for zero-first tokens. Before signing, it requests a fresh quote and refuses a fresh minimum below the reviewed minimum. The background stores the immutable canonical quote under a random short-lived handle, verifies the EIP-712 domain, recovers the active EOA from the signature, recomputes the 56-byte order UID, and submits only that stored order with the original quote ID and matching full app data. Off-chain contract-account signatures are not guessed: that path currently fails closed unless the account is an EOA.

Native-token input uses CoW's official EthFlow contract, not a relay. The quote uses wrapped native token as the protocol sell token and EIP-1271 as the on-chain order scheme. Hippo derives the EthFlow UID with `uint32.max` validity as prescribed by the contract, checks that the UID is unused, encodes the exact `createOrder` tuple, and estimates the transaction through the selected RPC. The transaction deposits only the signed sell amount. Native buy output uses CoW's native-token sentinel.

Order status is treated as untrusted. Hippo reconstructs the signed order fields, app-data hash, owner and validity from each response and requires the resulting EIP-712 UID to match the requested UID. Open EOA orders use signed batch cancellation through the order book. Open or expired EthFlow orders use the official on-chain `invalidateOrder` transaction; immediately before building it, Hippo verifies the API sender and EthFlow's on-chain `orders(orderDigest)` owner/validity mapping. The contract refunds any unsettled native balance. Fulfilled or cancelled orders cannot be cancelled. Order UIDs, transaction hashes and display metadata remain in extension-local history and are never reported to Rabby.

A quote handle is single-use. Definitive API rejection is surfaced without retry. A timeout, transport error, rate limit, server error, malformed success or mismatched returned UID triggers bounded lookup of the expected deterministic UID; if lookup cannot resolve the outcome, Hippo stores that UID as ambiguous instead of blindly creating another order.

The API receives the account/receiver, chain, token pair, amount, validity, app-data fields, source IP and—on submission—the public order and signature. CoW orders and EthFlow transactions are public by design. Hippo does not claim that a VPN hides those protocol-level fields.

## Provider caveats

Privacy descriptions are provider claims, not independent attestations:

- 1RPC publishes a zero-tracking design.
- dRPC's privacy policy permits temporary IP processing/logging for routing and rate limiting.
- PublicNode states that operational IP data may be retained for up to 24 hours.
- 0xRPC states that it does not log raw IP addresses.
- MEV Blocker receives signed raw Ethereum transactions submitted to it.
- CoW's order-book API receives the account/receiver, chain, pair, amount, validity, app-data fields, request metadata and source IP. On submission it receives the signed public order. EthFlow deposits, cancellations, refunds and settlements are public on-chain.

Public endpoints have quotas and may change method support without notice. No paid RPC credential or Hippo server credential is embedded.

## Release verification

A release is incomplete until the built MV3 artifact has passed:

- TypeScript and ESLint checks
- Focused policy, RPC, gas and CoW Protocol tests
- Full Jest suite
- Production MV3 build
- ZIP integrity and SHA-256 verification
- Manifest, branding and removed-feature scans
- Source-map and embedded source-map scans
- Fresh-profile Chromium load
- Two independent fresh-profile packaged-controller CoW smokes covering live ERC-20 quote validation, EIP-712 signature rejection, EthFlow transaction construction, live order-status validation, cancellation-state rejection and zero transport tabs
- First-run deny-all network trace
- Per-capability allowlist traces
- Signed-broadcast destination and call-count checks

The GitHub release must publish the tested ZIP and its matching SHA-256 digest.

## License and provenance

Hippo Wallet remains a Rabby Wallet derivative. Upstream notices, dependency attributions and the original license remain applicable. See `LICENSE`, `NOTICE` and the repository history.
