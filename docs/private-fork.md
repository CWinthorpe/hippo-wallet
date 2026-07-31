# Private fork: privacy and RPC routing

This fork permanently disables Rabby's behavioral telemetry. It does **not** yet remove every Rabby-operated feature API. Do not describe the current build as fully backend-independent or fully private.

## Disabled reporting

The private build removes or disables:

- `@debank/festats` event reporting;
- Google Analytics 4 events and page views;
- Matomo events and page views;
- Sentry client initialization, DSN, integrations, breadcrumbs, and event transport;
- periodic wallet/account/settings activity reports;
- persistent per-installation functional-API identifier headers;
- uninstall metrics and uninstall URLs.

Chrome MV3 builds also ship `rules/privacy.json`, which blocks requests to Google Analytics, DeBank Matomo, Sentry, and Rabby's uninstall endpoint as a defense-in-depth backstop. The tracking preference is compile-time locked to opt-out and cannot be re-enabled from storage or UI.

## Remaining operational disclosures

The wallet still relies on `api.rabby.io` and related Rabby/DeBank infrastructure for product functionality. Depending on the feature, those requests can include wallet addresses, dapp origins, unsigned transaction intent, simulation inputs, security checks, token/portfolio queries, feedback, and backend-managed transaction data. This fork clears the upstream API client's persistent per-installation `X-API-Key`/creation-time headers, but Rabby can still correlate functional requests through submitted addresses, origins, transaction data, IP address, timing, and other ordinary network metadata. Static asset requests expose the same ordinary network metadata.

A custom RPC controls the routed chain request and raw-transaction broadcast paths described below. It does not automatically replace transaction parsing, simulation, security analysis, portfolio, metadata, gasless, swap, bridge, gas-account, or other backend-managed flows.

WalletConnect uses Reown infrastructure. Pairing requires an operator-owned project ID, and Reown can observe the network metadata inherent in relay use. For normal WalletConnect `eth_sendTransaction` requests, the connected mobile wallet signs and broadcasts; this extension's custom broadcast RPC does not override that external-wallet path.

A future strict `rpc-only` mode would need to disable or replace the Rabby analysis and portfolio APIs and visibly accept reduced decoding, simulation, risk-warning, token, and portfolio coverage.

## Ordered RPC failover

Each custom chain configuration has:

1. one primary read/estimate RPC;
2. zero or more ordered read/estimate fallbacks;
3. one optional signed-transaction broadcast RPC (the primary is used when omitted).

Automatic fallback is limited to stateless reads and estimates after transport failures, timeouts, overloads, rate limits, or retryable gateway/server responses. Semantic failures such as contract reverts are returned immediately. Stateful filters, signing methods, `eth_sendTransaction`, and `eth_sendRawTransaction` never fail over.

A signed raw transaction is submitted to exactly one endpoint. Its returned transaction hash must be a 32-byte JSON-RPC hash. When the upstream default profile selects direct RPC broadcast, failure is surfaced and is not retried through Rabby's backend. Profiles that are backend-managed still use that backend as their sole destination; configure a custom broadcast RPC to avoid that path. To use MEV Blocker for protected broadcast, configure it explicitly as the broadcast RPC rather than relying on a silent fallback.

RPC URLs are currently stored using the upstream custom-RPC persistence model. Use credential-free public endpoints in this private build; do not store API-key-bearing URLs until encrypted RPC-profile storage is implemented.

## Build

Use an operator-owned Reown project ID:

```bash
WALLETCONNECT_PROJECT_ID='<your Reown project id>' \
  node .yarn/releases/yarn-4.14.1.cjs build:pro
```

Without that environment variable the extension still builds, but WalletConnect pairing intentionally refuses to initialize instead of using Rabby's upstream project identity.

## Verification

```bash
node .yarn/releases/yarn-4.14.1.cjs
node .yarn/releases/yarn-4.14.1.cjs check
node .yarn/releases/yarn-4.14.1.cjs test --runInBand
WALLETCONNECT_PROJECT_ID='private-build-verification' \
  node .yarn/releases/yarn-4.14.1.cjs build:pro
```

Before using meaningful funds, load the unpacked build in a clean browser profile, inspect its network traffic, test WalletConnect on the intended mobile wallet, and run a low-value transaction through the configured read and broadcast endpoints.
