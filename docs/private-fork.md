# Hippo Wallet privacy and trust boundary

Hippo Wallet is a downstream Rabby Wallet build intended for direct inspection and self-hosted use. It does not operate a Hippo telemetry collector, RPC relay, or account backend.

The relevant distinction is between **telemetry** and **functional API disclosure**. Hippo removes intentional product analytics, crash reporting, uninstall reporting, ratings, and automatic security-action logging. It still calls upstream services when a requested feature cannot work without them.

## Removed or disabled telemetry

The production build applies all of the following controls:

- The statistics adapter is a local no-op.
- GA4 and Matomo helpers do not transmit events.
- Sentry is not initialized in the UI or background service worker.
- The sourcemap build has no Sentry upload path.
- Browser uninstall reporting is reset to an empty URL.
- Rating prompts and settings entry points are removed.
- Onboarding cannot silently opt a user into tracking.
- Persisted Rabby API installation identifiers are cleared and write-blocked.
- Transaction, message, and typed-data approval components do not call `postActionLog`.
- Both OpenAPI clients override `postActionLog` with a no-op.
- The MV3 declarative network rules block `https://api.rabby.io/v1/engine/action/log` as defense in depth.

The declarative rules also block known GA, Matomo, Sentry, and Rabby uninstall-reporting destinations across all resource types.

## Retained functional upstream APIs

Enhanced wallet features still depend on Rabby/DeBank or feature-specific services. Examples include:

- Portfolio, token, NFT, and transaction-history aggregation.
- Transaction, message, and typed-data parsing or simulation.
- Address, contract, origin, phishing, and risk checks.
- Gas-account and gasless transaction coordination.
- Swap, bridge, lending, perps, feedback, and other explicitly invoked integrations.
- WalletConnect, hardware-wallet, or exchange-wallet services when the user chooses those account types.

These are not anonymized by Hippo. A service may receive the real wallet address, dapp origin, unsigned transaction, message, typed data, or signed payload required for the operation. A VPN hides the residential IP from the service but does not hide those payloads.

Hippo deliberately does **not** add a project-operated privacy relay. For a small installation base, a stable relay can become a more deterministic correlation point and an unnecessary operational trust dependency.

## RPC control plane

Hippo removes Rabby from ordinary default RPC selection:

- No periodic call to Rabby's `/v1/chainrpc` routing endpoint.
- No default use of Rabby's `/v1/wallet/eth_rpc` JSON-RPC proxy.
- Both methods are disabled on the OpenAPI clients and their exact network paths are blocked by MV3 declarative rules.
- No default `submitTxV2` path for an ordinary locally signed transaction.
- No silent Rabby fallback when a bundled route is absent.

A static, reviewed provider map is bundled at `src/constant/default-rpc-providers.json`. It was reviewed on 2026-08-01 against:

- 1RPC's official network table.
- dRPC's official chain list.
- Chainlist's public endpoint metadata for PublicNode and 0xRPC.
- Direct `eth_chainId` and `eth_blockNumber` probes during release validation.

### Route precedence

For a configured custom profile:

1. Custom primary URL.
2. Custom fallback URLs for replay-safe reads and estimates.
3. Custom broadcast URL for signed transactions, or the custom primary when no broadcast URL is supplied.

Without a custom profile:

1. 1RPC.
2. dRPC.
3. PublicNode.
4. 0xRPC.

Fallback is sequential. No parallel racing is used.

### Retry policy

Automatic retry is limited to replay-safe reads and estimates. It may advance after:

- HTTP `408`, `425`, `429`, `500`, `502`, `503`, or `504`.
- Selected transient JSON-RPC codes, including 1RPC's documented `-32001` quota error.
- Recognized network transport failures.
- A malformed result that fails method-specific validation.

It does not advance after semantic errors such as execution reverts, invalid parameters, user rejection, or deterministic contract failures. Stateful filter methods and wallet-controlled send methods are pinned to one endpoint.

Ordinary locally signed raw transaction submission uses one endpoint only. An HTTP timeout is ambiguous: the first provider may have accepted the transaction even if the wallet never received the response. Automatically rebroadcasting would widen disclosure and create misleading error behavior. The user can retry after checking the transaction hash or chain state.

Gasless, gas-account, and explicitly selected MEV-protected transactions remain backend-assisted because their sponsorship, accounting, or private-orderflow contracts require it. External wallets such as WalletConnect or Coinbase may perform their own broadcast.

## Coverage

The bundled source currently lists 86 integrated networks:

- 67 have one or more approved built-in RPC endpoints.
- 19 require an explicit custom RPC: Oasys, Conflux, Story, Reya, Botanix, Citrea, IoTeX, BounceBit, Cyber, Etherlink, Zircuit, Sophon, DFK Chain, Chiliz, Mitosis, Taiko, Bitlayer, DBK Chain, and Plasma.

Plasma is deliberately excluded from the built-in map because the advertised dRPC endpoint returned the correct chain ID but rejected ordinary methods such as `eth_blockNumber`; a chain-ID-only response is not a usable wallet RPC.

An upgrade always replaces stale persisted **default** Rabby routing with the bundled map. It preserves and normalizes the user's existing custom primary, fallback, broadcast, and enabled state.

## Provider caveats

Privacy descriptions are vendor statements, not independent attestations:

- 1RPC publishes a zero-tracking design and is the preferred built-in endpoint where supported.
- dRPC offers greater coverage but its privacy policy allows temporary IP processing/logging for routing and rate limiting.
- PublicNode states that operational IP data may be retained for up to 24 hours.
- 0xRPC states that it does not log raw IP addresses, but it supports comparatively few networks.

Public endpoints have quotas and may change method support without notice. The wallet therefore validates response shape, applies narrow failover, and keeps custom RPC configuration available. No commercial API key is embedded in the extension.

## Verification requirements

A release is not complete until the built MV3 artifact—not merely the source tree—has been checked for:

- Correct Hippo name, version, homepage, icons, and onboarding UI.
- Included privacy declarative rules.
- Included static provider map.
- No known analytics or crash collector credentials.
- No source-map files or source-map comments.
- No Rabby default RPC discovery/proxy references.
- A successful fresh-profile Chromium launch.
- Runtime observation confirming no recognized analytics, crash, uninstall, or action-log requests during the smoke window.
- A published SHA-256 digest and a matching GitHub release asset.

## License and provenance

Hippo Wallet remains a Rabby Wallet derivative. Upstream notices, dependency attributions, and the original license remain applicable. See `LICENSE`, `NOTICE`, and the repository history.
