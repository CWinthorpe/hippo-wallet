# Hippo Wallet

Hippo Wallet is a privacy-focused, self-custodial Chromium wallet derived from [Rabby Wallet](https://github.com/RabbyHub/Rabby). It is built for a single operator who wants explicit control over remote data disclosure, auditable RPC routing and fewer backend-dependent features.

## Current release

- **Version:** `0.94.7-hippo.13`
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

There is no claim of complete offline operation. The selected RPC provider sees RPC traffic. Optional Rabby/DeBank features receive the data needed for that specific request after permission is granted. CoW Protocol and MEV Blocker have separate trust boundaries described below.

### User-controlled RPC routing

Hippo does not download a routing table from Rabby and does not use Rabby's generic RPC proxy. The reviewed built-in map is versioned at [`src/constant/default-rpc-providers.json`](src/constant/default-rpc-providers.json).

Routing order:

1. User-configured custom RPC.
2. User-configured fallback RPCs for replay-safe reads and estimates.
3. Otherwise, the bundled 1RPC route.
4. dRPC, PublicNode and 0xRPC where listed and needed.

Read failover is sequential, never parallel, and is restricted to replay-safe reads and estimates after transport, quota, selected server or malformed-result failures. Execution reverts and other semantic failures return immediately.

Gas recommendations and gas estimation come from the selected RPC using `eth_feeHistory`, `eth_maxPriorityFeePerGas`, the latest block's base fee, `eth_gasPrice` and `eth_estimateGas`. There is no centralized gas-price fallback.

The bundled map currently covers **67 of 89** networks. The other networks require a custom RPC; see [docs/private-fork.md](docs/private-fork.md).

### One-destination transaction submission

A signed transaction is submitted to exactly one destination for each attempt:

- A configured custom broadcast RPC always wins.
- Eligible ordinary Ethereum Mainnet transactions use [MEV Blocker](https://mevblocker.io/) at its `fullprivacy` endpoint.
- Other transactions use the first selected ordinary RPC.

Hippo computes the transaction hash locally and rejects malformed or mismatched submission results. It never automatically rebroadcasts after a timeout, disconnect, malformed response or other ambiguous outcome. Such a result may mean the first endpoint already accepted the transaction; blind failover would leak it to another provider.

### Direct CoW Protocol swaps

Rabby's quote, fee, gas-estimation and trade-reporting pipeline has been removed. Hippo uses only CoW Protocol's documented production order-book API at `https://api.cow.fi/<network>/api/v1`; there is no intermediary quote aggregator, Hippo relay or provider API key. The integration is same-chain only and deliberately does not restore any bridge path.

Supported production networks are Ethereum, BNB Chain, Gnosis Chain, Polygon, Base, Plasma, Arbitrum One, Avalanche, Ink and Linea. The selector combines reviewed native, wrapped-native and stablecoin defaults with wallet assets when Portfolio discovery is enabled. Name and symbol search follows that consent; an exact contract can always be validated through the selected RPC and requires an explicit warning confirmation when it is not a reviewed token. Token contract code, decimals, symbols, balances, protocol contracts and transaction estimates are read through the selected Hippo RPC policy. Buy-side native output uses CoW's native-token sentinel.

For ERC-20 input, Hippo requests an optimal verified sell quote, computes the signed minimum locally with CoW's published sell-order rounding formula, and approves only the exact sell amount to CoW's fixed Vault Relayer. The wallet signs the exact reviewed EIP-712 order for the fixed `Gnosis Protocol` v2 domain and settlement contract. If that order is too close to expiry, Hippo replaces it and requires another review rather than silently signing different fields. The background independently recovers the EOA, recomputes the order UID and submits the immutable stored order. Contract-account execution is rejected rather than guessed.

For native-token input, Hippo builds an on-chain order for CoW's official EthFlow contract. It validates the quote, derives the `uint32.max` protocol UID prescribed by EthFlow while preserving the reviewed user expiry in the contract order, checks for UID collisions, estimates the exact `createOrder` transaction and deposits only the reviewed sell amount. Native orders can be invalidated through EthFlow; invalidation refunds any unsettled native balance.

Order UIDs and creation hashes are stored only in extension-local history. Hippo validates order-book status responses against each EIP-712 UID, supports signed off-chain cancellation for open EOA orders, and supports on-chain cancellation/refund for open or expired EthFlow orders after verifying the contract's owner/validity mapping. Ambiguous submissions are tracked by their expected UID instead of being blindly retried.

Transport is limited to the exact CoW API origins, networks, methods and paths used for quote, submission, status and cancellation. Requests use fixed JSON headers, omit credentials and referrers, reject redirects, and enforce timeout, request-size and streamed response-size limits. Quote and order responses fail closed on malformed or mismatched owner, domain, chain, token, amount, receiver, app-data hash, fee, balance source, signing scheme, validity or UID.

### Deliberately fewer features

This release removes the code, routes, services, assets, dependencies and locale sections for:

- Rabby gas accounts, Rabby-relayed gasless paths and sponsored submission
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
- **Approval discovery:** may disclose wallet address and chain to Rabby/DeBank when enabled. The displayed ERC-20 and NFT approval list is provider-indexed. Revoke calldata is constructed locally and sent through the normal wallet/RPC path, but the wallet does not independently re-read every displayed approval on-chain before display or revoke construction. EIP-7702 delegation checks use a separate RPC-backed path.
- **RPC providers:** receive the JSON-RPC requests routed to them.
- **WalletConnect/Reown:** receives pairing and session traffic when you use
  WalletConnect. Hippo ships its own public Reown project ID; it does not use
  Rabby's project identity.
- **CoW Protocol:** receives token, amount, account/receiver, validity, app-data fields, source IP and request metadata for deliberate quote, order, status and cancellation requests, including automatic status polling while the Swap page is open. The app data identifies the client as `Hippo Wallet` but contains no installation identifier. ERC-20 order signatures and public order UIDs are submitted to CoW's order book; native orders are also visible on-chain through EthFlow.
- **MEV Blocker:** receives the signed raw transaction for eligible Ethereum Mainnet submission.
- **External account integrations:** WalletConnect, Coinbase, Safe and hardware-wallet integrations may contact their own relays, services or vendor endpoints when used.

Provider privacy statements are claims by those providers, not independent guarantees. Review the implementation, [docs/private-fork.md](docs/private-fork.md) and each provider's current policy before using the wallet with sensitive accounts.

## Browser permissions

The MV3 release requests `<all_urls>` and injects its provider bridge into all HTTP(S) and `file://` frames so dapps can reach the wallet. It also requests scripting, storage, unlimited storage, alarms, active-tab, notifications, offscreen, context-menu and declarative-network-request permissions. It does not request `webRequest`, `webRequestBlocking` or `debugger`. These broad compatibility permissions make the consent policy and reviewed transport boundaries security-critical.

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
node .yarn/releases/yarn-4.14.1.cjs check
node .yarn/releases/yarn-4.14.1.cjs test --runInBand
node .yarn/releases/yarn-4.14.1.cjs build:pro
node .yarn/releases/yarn-4.14.1.cjs verify:dist
```

The unpacked MV3 build is written to `dist/`.

Hippo's public, operator-owned Reown project ID is bundled so WalletConnect
works in release and local builds. Set `WALLETCONNECT_PROJECT_ID` only to
override that ID for a separately operated build.

Focused privacy, routing and replacement tests:

```bash
node .yarn/releases/yarn-4.14.1.cjs test \
  __tests__/background/remoteDataPolicy.test.ts \
  __tests__/background/openapiPrivacy.test.ts \
  __tests__/background/defaultRPCProviders.test.ts \
  __tests__/background/rpcService.test.ts \
  __tests__/background/rpcGas.test.ts \
  __tests__/background/cowSwap.test.ts \
  __tests__/background/cowSwapTransport.test.ts \
  __tests__/ui/cowSwapSafety.test.ts \
  __tests__/ui/cowSwapTokens.test.ts \
  __tests__/ui/cowSwapWallet.test.ts \
  __tests__/privacy/privateBuildPrivacy.test.ts \
  --runInBand --no-cache
```

## Upstream and license

Hippo Wallet remains a downstream Rabby fork. Upstream copyright and license notices are retained. See [LICENSE](LICENSE), [NOTICE](NOTICE) and [docs/private-fork.md](docs/private-fork.md).
