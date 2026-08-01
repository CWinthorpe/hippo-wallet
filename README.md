# Hippo Wallet

Hippo Wallet is a privacy-focused, self-custodial Chromium wallet derived from [Rabby Wallet](https://github.com/RabbyHub/Rabby). It is built for a single operator who wants explicit control over remote data disclosure, auditable RPC routing and fewer backend-dependent features.

## Current release

- **Version:** `0.93.102-hippo.5`
- **Target:** Chromium Manifest V3
- **Repository:** [CWinthorpe/hippo-wallet](https://github.com/CWinthorpe/hippo-wallet)

Download the ZIP from the [latest GitHub release](https://github.com/CWinthorpe/hippo-wallet/releases/latest) and verify its published SHA-256 digest before installation.

## What makes Hippo Wallet Hippo Wallet

### Consent before contact

Hippo starts with every Rabby/DeBank-backed capability disabled. On first run—and after upgrading from a build without a saved policy—the wallet asks what may be enabled before opening the normal wallet interface.

The same controls remain under **Settings → Privacy & Data Sources**:

- Portfolio, token and DeFi data
- Transaction history
- NFT viewing and metadata
- Enhanced transaction, message and typed-data analysis
- Approval and allowance discovery
- Security and reputation lookups
- Dapp discovery
- Feedback submission

Each permission is independent. Enabling one does not enable another. Enabling a permission does not prefetch data; the request occurs only when the corresponding feature is used. **Block all** turns every capability off, stops future provider calls and clears provider-derived caches for the current account. Removing the block does not silently restore old selections.

The policy is enforced in the background request adapter, not merely by hiding buttons. Missing, malformed or unknown policy state means deny. Unknown Rabby/DeBank endpoints also fail closed. Blocked requests are rejected locally, are not queued and do not generate remote identifiers.

### No Hippo backend

Hippo operates no relay, proxy, analytics collector or telemetry server. Product analytics, crash reporting, uninstall reporting, automatic action logging and persistent Rabby API identifiers remain disabled.

There is no claim of complete offline operation. The selected RPC provider sees RPC traffic. Optional Rabby/DeBank features receive the data needed for that specific request after permission is granted. LlamaSwap and MEV Blocker have separate trust boundaries described below.

### User-controlled RPC routing

Hippo does not download a routing table from Rabby and does not use Rabby's generic RPC proxy. The reviewed built-in map is versioned at [`src/constant/default-rpc-providers.json`](src/constant/default-rpc-providers.json).

Routing order:

1. User-configured custom RPC.
2. User-configured fallback RPCs for replay-safe reads and estimates.
3. Otherwise, the bundled 1RPC route.
4. dRPC, PublicNode and 0xRPC where listed and needed.

Read failover is sequential, never parallel, and is restricted to replay-safe reads and estimates after transport, quota, selected server or malformed-result failures. Execution reverts and other semantic failures return immediately.

Gas recommendations and gas estimation come from the selected RPC using `eth_feeHistory`, `eth_maxPriorityFeePerGas`, the latest block's base fee, `eth_gasPrice` and `eth_estimateGas`. There is no centralized gas-price fallback.

The bundled map currently covers **67 of 86** networks. The other networks require a custom RPC; see [docs/private-fork.md](docs/private-fork.md).

### One-destination transaction submission

A signed transaction is submitted to exactly one destination for each attempt:

- A configured custom broadcast RPC always wins.
- Eligible ordinary Ethereum Mainnet transactions use [MEV Blocker](https://mevblocker.io/) at its `fullprivacy` endpoint.
- Other transactions use the first selected ordinary RPC.

Hippo computes the transaction hash locally and rejects malformed or mismatched submission results. It never automatically rebroadcasts after a timeout, disconnect, malformed response or other ambiguous outcome. Such a result may mean the first endpoint already accepted the transaction; blind failover would leak it to another provider.

### Direct same-chain swaps

Rabby's quote, fee, gas-estimation and trade-reporting pipeline has been removed. Hippo requests same-chain quotes directly from LlamaSwap's production frontend API. For each supported chain it queries every ordinary transaction adapter exposed by LlamaSwap that Hippo can execute: **1inch, KyberSwap, ParaSwap and Matcha/0x v2** where available. LlamaSwap's separate `0x Gasless` adapter is deliberately excluded because Hippo does not support relayed, sponsored or gasless submission.

Hippo shows every route that passes provider-specific validation and defaults to the highest quoted token output; the user can select another validated aggregator. Validation covers the selected chain, token addresses, exact input, quoted and minimum output, recipient, approval spender, transaction target, entry point/calldata, native value and fee fields. 1inch, KyberSwap and ParaSwap use fixed allowlisted routers. Matcha's current Settler target is checked on-chain against 0x's official deployment registry; ERC-20 Matcha routes additionally require an exact-token Permit2 authorization whose typed data is checked locally before signing.

Cloudflare challenges direct service-worker POSTs from a `chrome-extension://` origin. For an explicit quote request, Hippo therefore opens one temporary **inactive** tab at `swap-api.defillama.com`, runs the parallel requests in Chrome's isolated extension world with that page origin, and closes the tab in a `finally` path. That API origin is excluded from Hippo's ordinary dapp-provider content-script injection. No remote script receives extension privileges, and every returned field remains untrusted until the provider-specific checks pass. The tab may briefly appear in the browser's tab strip, and the bare API origin may remain in local browser history; Hippo best-effort strips Cloudflare challenge query parameters from the temporary tab's current history entry before closing it.

Approvals are exact-amount approvals rather than unlimited approvals. The selected provider is refreshed before submission; provider or target changes require another review. Submitted swap hashes are stored locally, and Hippo does not post trade history to Rabby.

LlamaSwap's frontend endpoint is not a documented third-party wallet API and may change or apply anti-bot controls without notice. The embedded frontend credential is public by design and is not a secret. If validation fails, Hippo refuses the quote rather than guessing.

### Deliberately fewer features

This release removes the code, routes, services, assets, dependencies and locale sections for:

- Gas accounts, gasless transactions and sponsored submission
- Points, badges, campaigns, referrals, gifts and promotional ecosystems
- Perpetual trading, Hyperliquid services and the floating trading widget
- Every bridge flow, including Hyperliquid and DBK bridge helpers
- NFT listings, offers, sales and marketplace execution
- Specialized staking and faucet flows
- Rabby swap adapters, swap fees and trade reporting
- Backend transaction-broadcast watchers

The retained generated Rabby API client still contains legacy method names and endpoint strings because the same client supplies the optional portfolio and analysis APIs. Hippo classifies the removed endpoint families centrally and rejects them before transport; those strings do not indicate active feature routes or permission to call them.

NFT viewing and ordinary NFT transfers remain available when their relevant data permission is enabled. Core signing, hardware-wallet, migration and injected-provider compatibility identifiers remain where renaming them would break dapps or existing installations. They are not claims of an active Rabby backend relationship.

## Provider privacy boundaries

A VPN may hide a residential IP address, but it does not hide wallet addresses, chain IDs, calldata, origins, typed data or token interests included in a request.

- **Portfolio/history/NFT/DeFi:** may disclose wallet address, chains and requested asset or protocol context to Rabby/DeBank when enabled.
- **Enhanced signing analysis:** may disclose origin, wallet, chain, destination, value, calldata, messages or typed-data contents when enabled.
- **Approval discovery:** may disclose wallet address and chain when enabled. Current allowance state is verified through the selected RPC before display or revoke construction.
- **RPC providers:** receive the JSON-RPC requests routed to them.
- **LlamaSwap:** receives quote parameters and the swap recipient for deliberate quote requests.
- **MEV Blocker:** receives the signed raw transaction for eligible Ethereum Mainnet submission.

Provider privacy statements are claims by those providers, not independent guarantees. Review [docs/private-fork.md](docs/private-fork.md) before using the wallet with sensitive accounts.

## Install the release ZIP

1. Download the MV3 ZIP from [GitHub Releases](https://github.com/CWinthorpe/hippo-wallet/releases).
2. Verify its SHA-256 digest against the release notes.
3. Extract the ZIP.
4. Open `chrome://extensions` or the equivalent Chromium extension page.
5. Enable **Developer mode**.
6. Select **Load unpacked** and choose the extracted directory.

Back up seed phrases and private keys before replacing any wallet installation. Treat this as security-sensitive software.

## Build from source

Prerequisites:

- Node.js 22
- The repository-pinned Yarn 4 release

```bash
git clone https://github.com/CWinthorpe/hippo-wallet.git
cd hippo-wallet
node .yarn/releases/yarn-4.14.1.cjs install --immutable
node .yarn/releases/yarn-4.14.1.cjs typecheck
node .yarn/releases/yarn-4.14.1.cjs build:pro
```

The unpacked MV3 build is written to `dist/`.

Focused privacy, routing and replacement tests:

```bash
node .yarn/releases/yarn-4.14.1.cjs test \
  __tests__/background/remoteDataPolicy.test.ts \
  __tests__/background/openapiPrivacy.test.ts \
  __tests__/background/defaultRPCProviders.test.ts \
  __tests__/background/rpcService.test.ts \
  __tests__/background/rpcGas.test.ts \
  __tests__/background/llamaSwap.test.ts \
  __tests__/privacy/privateBuildPrivacy.test.ts \
  --runInBand --no-cache
```

## Upstream and license

Hippo Wallet remains a downstream Rabby fork. Upstream copyright and license notices are retained. See [LICENSE](LICENSE), [NOTICE](NOTICE) and [docs/private-fork.md](docs/private-fork.md).
