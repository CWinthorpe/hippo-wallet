# Hippo Wallet

Hippo Wallet is a privacy-focused, self-custodial Chromium wallet derived from [Rabby Wallet](https://github.com/RabbyHub/Rabby). It is built for a single operator who wants explicit control over remote data disclosure, auditable RPC routing and fewer backend-dependent features.

## Current release

- **Version/tag:** [`v0.93.105-hippo.8`](https://github.com/CWinthorpe/hippo-wallet/releases/tag/v0.93.105-hippo.8)
- **Commit:** [`863666bfb9d7e90a8a18b03f881961baead60f01`](https://github.com/CWinthorpe/hippo-wallet/commit/863666bfb9d7e90a8a18b03f881961baead60f01)
- **Target:** Chromium Manifest V3
- **Artifact:** `hippo-wallet-v0.93.105-hippo.8-mv3.zip`
- **Size:** `13,699,960` bytes
- **SHA-256:** `18f71c5cc77f246d9932ca81863bcc64010250b9e76db9b775b58774d9d0b8cd`
- **Access:** The [repository](https://github.com/CWinthorpe/hippo-wallet) and its releases are private; authenticated GitHub access is required.

The release passed `yarn`, `yarn check`, the full Jest suite (49 suites; 292 passed, 1 skipped), the production MV3 build, the artifact/privacy scan and ZIP integrity verification. Packaged-browser smoke testing was intentionally not run, so this artifact remains incomplete under the documented [release checklist](docs/private-fork.md#release-verification).

Download the ZIP from the [tagged GitHub release](https://github.com/CWinthorpe/hippo-wallet/releases/tag/v0.93.105-hippo.8) and verify the digest above before installation. The current release and its lightweight tag are mutable and unsigned, so the digest detects corruption relative to the release notes but is not an independent publisher-authenticity guarantee.

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

Capability switches are stored separately, but some Rabby/DeBank endpoints serve multiple categories and are allowed when any category assigned to that endpoint is enabled. Portfolio, NFT and Dapp media also share a host-level media gate. Saving a switch does not itself contact a provider, but mounted wallet views may immediately use any endpoint authorized by the resulting policy. Enabling one category can therefore permit a shared endpoint used by another view, and disabling one category does not block that endpoint while another assigned category remains enabled.

**Block all** changes the settings form; press **Save privacy settings** to enforce it. Saving reduced access stops future calls covered by the disabled categories, clears provider-derived caches for the current account and clears the complete local provider contact log. Re-enabling the form does not silently restore old selections.

The policy is enforced in the background request adapter, not merely by hiding buttons. No configured policy, known removed endpoints and unknown or unclassified Rabby/DeBank endpoints fail closed. Blocked requests are rejected locally, are not queued and do not generate remote identifiers.

### No Hippo backend

Hippo operates no relay, proxy, analytics collector or telemetry server. Product analytics, crash reporting, uninstall reporting, automatic action logging and persistent Rabby API identifiers remain disabled.

There is no claim of complete offline operation. The selected RPC provider sees RPC traffic. Optional Rabby/DeBank features receive the data needed for that specific request after permission is granted. CoW Protocol and MEV Blocker have separate trust boundaries described below.

### User-controlled RPC routing

Hippo does not download a routing table from Rabby and does not use Rabby's generic RPC proxy. The reviewed built-in map is versioned at [`src/constant/default-rpc-providers.json`](src/constant/default-rpc-providers.json).

With an enabled custom profile, reads use the custom primary followed only by its configured fallbacks for replay-safe reads and estimates; they do not spill into bundled endpoints. Without a custom profile, Hippo uses the endpoints present for that chain in reviewed 1RPC, dRPC, PublicNode and 0xRPC order. Not every chain has a 1RPC endpoint.

Fallback attempts for an individual request are sequential and occur only after transport, quota, selected server or malformed-result failures. Execution reverts and other semantic failures return immediately. Distinct gas-data requests may execute concurrently, but each request follows its own sequential route.

Gas recommendations and gas estimation come from the selected RPC using `eth_feeHistory`, `eth_maxPriorityFeePerGas`, the latest block's base fee, `eth_gasPrice` and `eth_estimateGas`. There is no centralized gas-price fallback.

The bundled map currently covers **67 of 86** networks. Oasys, Conflux, Story, Reya, Botanix, Citrea, IoTeX, BounceBit, Cyber, Etherlink, Zircuit, Sophon, DFK Chain, Chiliz, Mitosis, Taiko, Bitlayer, DBK Chain and Plasma require a custom RPC.

### One-destination raw-transaction submission

For raw transactions serialized and broadcast by Hippo, each attempt is submitted to exactly one destination:

- An enabled custom profile's configured broadcast RPC always wins.
- Eligible ordinary Ethereum Mainnet transactions use [MEV Blocker](https://mevblocker.io/) at its `fullprivacy` endpoint.
- Other transactions use the first selected ordinary RPC.

Hippo computes the transaction hash locally and rejects malformed or mismatched submission results. It never automatically rebroadcasts after a timeout, disconnect, malformed response or other ambiguous outcome. Such a result may mean the first endpoint already accepted the transaction; blind failover would leak it to another provider.

MEV Blocker is skipped for speed-ups, cancellations, EIP-7702 transactions and Tempo transactions. WalletConnect, Coinbase, Safe and other external signers may use their own submission infrastructure; their broadcasts are outside Hippo's one-destination and local-hash guarantees.

### Direct CoW Protocol swaps

Rabby's quote, fee, gas-estimation and trade-reporting pipeline has been removed. Hippo uses only CoW Protocol's documented production order-book API at `https://api.cow.fi/<network>/api/v1`; there is no intermediary quote aggregator, Hippo relay or provider API key. The integration is same-chain only and deliberately does not restore any bridge path.

Supported production networks are Ethereum, BNB Chain, Gnosis Chain, Polygon, Base, Plasma, Arbitrum One, Avalanche, Ink and Linea. Plasma has no bundled RPC route and requires a custom RPC. The selector combines reviewed native, wrapped-native and stablecoin defaults with wallet assets when Portfolio discovery is enabled. Wallet discovery, remote name or symbol search and selector-list balances come from Rabby/DeBank under that permission. Exact contract-address lookup remains available through the selected RPC; a non-reviewed contract requires explicit risk confirmation and is selected only for the current swap rather than persisted automatically as a customized token.

Before quoting, Hippo re-reads each selected ERC-20's contract code, decimals, symbol and current account balance through the selected RPC. Native-token metadata comes from the bundled chain definition, while its balance is read through RPC. Protocol contracts and transaction estimates use the same RPC policy. **Max** is available for ERC-20 sells and enters the full token balance; native sells have no Max button, so reserve native currency for gas manually. Reversing the token pair clears the amount and reviewed quote. Buy-side native output uses CoW's native-token sentinel.

Swap execution is EOA-focused. Approvals, transactions and EIP-712 signing use the selected account's normal wallet request path, but routing through that path does not guarantee compatibility with every keyring. Watch-only accounts cannot execute. Deployed contract accounts, including Safe/Cobo-style accounts, are rejected. An EIP-7702 delegated EOA is accepted only for native EthFlow execution; ERC-20 off-chain orders reject delegated accounts.

For ERC-20 input, Hippo requests an optimal verified sell quote, computes the signed minimum locally with CoW's published sell-order rounding formula, and approves only the exact sell amount to CoW's fixed Vault Relayer. The wallet signs the exact reviewed EIP-712 order for the fixed `Gnosis Protocol` v2 domain and settlement contract. If that order is too close to expiry, Hippo replaces it and requires another review rather than silently signing different fields. The background independently recovers the EOA, recomputes the order UID and submits the immutable stored order. Contract-account execution is rejected rather than guessed.

For native-token input, Hippo builds an on-chain order for CoW's official EthFlow contract. It validates the quote, derives the `uint32.max` protocol UID prescribed by EthFlow while preserving the reviewed user expiry in the contract order, checks for UID collisions, estimates the exact `createOrder` transaction and deposits only the reviewed sell amount. Native orders can be invalidated through EthFlow; invalidation refunds any unsettled native balance.

Quote and cancellation handles exist only in service-worker memory; a worker restart requires a fresh review. Order UIDs, transaction hashes and display metadata are stored as JSON in extension-local `localStorage`, capped at 100 entries and not synchronized. While the Swap page is open, Hippo polls up to ten non-terminal orders every 15 seconds. It validates order-book status responses against each EIP-712 UID, supports signed off-chain cancellation for open EOA orders, and supports on-chain cancellation/refund for open or expired EthFlow orders after verifying the contract's owner/validity mapping. Ambiguous submissions are tracked by their expected UID instead of being blindly retried.

Transport is limited to the exact CoW API origins, networks, methods and paths used for quote, submission, status and cancellation. Requests use fixed JSON headers, omit credentials and referrers, reject redirects, and enforce timeout, request-size and streamed response-size limits. Quote and order responses fail closed on malformed or mismatched owner, domain, chain, token, amount, receiver, app-data hash, fee, balance source, signing scheme, validity or UID.

### Deliberately fewer features

This release removes the normal user-facing routes and primary background services or startup hooks for:

- Rabby gas accounts, Rabby-relayed gasless paths and sponsored submission
- Points, badges, campaigns, referrals, gifts and promotional ecosystems
- Perpetual trading, Hyperliquid services and the floating trading widget
- Normal bridge routes and execution flows, including Hyperliquid and DBK bridges
- NFT listings, offers, sales and marketplace execution
- Specialized staking and faucet flows
- The wallet Swap route's Rabby adapters, swap fees and trade reporting
- Backend transaction-broadcast watchers

Dormant upstream source, generated API methods, dependencies, assets and locale strings remain in parts of the repository; some retained dependencies also serve features outside the removed product routes. Source-tree presence must not be described as complete removal or treated as proof of an active route.

The retained generated Rabby API client still contains legacy method names and endpoint strings because the same client supplies the optional portfolio and analysis APIs. Hippo classifies removed endpoint families centrally and rejects them before transport; those strings do not indicate permission to call them.

NFT viewing and ordinary NFT transfers remain available when their relevant data permission is enabled. Core signing, hardware-wallet, migration and injected-provider compatibility identifiers remain where renaming them would break dapps or existing installations. They are not claims of an active Rabby backend relationship.

## Provider privacy boundaries

A VPN may hide a residential IP address, but it does not hide wallet addresses, chain IDs, calldata, origins, typed data or token interests included in a request.

- **Portfolio/history/NFT/DeFi:** may disclose wallet address, chains and requested asset or protocol context to Rabby/DeBank when enabled.
- **Enhanced signing analysis:** may disclose origin, wallet, chain, destination, value, calldata, messages or typed-data contents when enabled.
- **Approval discovery:** may disclose wallet address and chain to Rabby/DeBank when enabled. The displayed ERC-20 and NFT approval list is provider-indexed. Revoke calldata is constructed locally and sent through the normal wallet/RPC path, but this release does not independently re-read every displayed approval on-chain before display or revoke construction. EIP-7702 delegation checks use a separate RPC-backed path.
- **RPC providers:** receive the JSON-RPC requests routed to them.
- **CoW Protocol:** receives token, amount, account/receiver, validity, app-data fields, source IP and request metadata for deliberate quote, order, status and cancellation requests, including automatic status polling while the Swap page is open. The app data identifies the client as `Hippo Wallet` but contains no installation identifier. ERC-20 order signatures and public order UIDs are submitted to CoW's order book; native orders are also visible on-chain through EthFlow.
- **MEV Blocker:** receives the signed raw transaction for eligible Ethereum Mainnet submission.
- **External account integrations:** WalletConnect, Coinbase, Safe and hardware-wallet integrations may contact their own relays, services or vendor endpoints when used.

Provider privacy statements are claims by those providers, not independent guarantees. Review the implementation and each provider's current policy before using the wallet with sensitive accounts.

## Browser permissions

The MV3 release requests `<all_urls>` and injects its provider bridge into all HTTP(S) and `file://` frames so dapps can reach the wallet. It also requests scripting, storage, unlimited storage, alarms, active-tab, notifications, offscreen, context-menu and declarative-network-request permissions. It does not request `webRequest`, `webRequestBlocking` or `debugger`. These broad compatibility permissions make the consent policy and reviewed transport boundaries security-critical.

## Install the release ZIP

1. Download the MV3 ZIP from the [current tagged release](https://github.com/CWinthorpe/hippo-wallet/releases/tag/v0.93.105-hippo.8).
2. Verify its SHA-256 digest against the value in [Current release](#current-release).
3. Back up the wallet before replacing an existing installation.
4. Extract Hippo into a stable directory that you will retain across upgrades.
5. Open `chrome://extensions` or the equivalent Chromium extension page.
6. Enable **Developer mode**.
7. Select **Load unpacked** and choose the extracted directory.

For an upgrade, first verify the recovery phrase or private-key backup, preserve the stable directory itself but delete all files and subdirectories inside it, extract the new release into that empty directory, then click **Reload** on the existing extension. Do not load every release from a different path: the manifest has no fixed key, so a different unpacked path can create a different extension ID and separate wallet storage. The unpacked build has no automatic update URL, so monitor and apply releases manually. An unpacked Hippo installation also does not automatically share storage with an installed Rabby extension. Treat this as security-sensitive software.

## Build from source

Prerequisites:

- Node.js 22
- The repository-pinned Yarn 4 release

```bash
git clone --branch v0.93.105-hippo.8 --single-branch \
  https://github.com/CWinthorpe/hippo-wallet.git
cd hippo-wallet
test "$(git rev-parse HEAD)" = \
  "863666bfb9d7e90a8a18b03f881961baead60f01"
node .yarn/releases/yarn-4.14.1.cjs install --immutable
node .yarn/releases/yarn-4.14.1.cjs check
node .yarn/releases/yarn-4.14.1.cjs test --runInBand
node .yarn/releases/yarn-4.14.1.cjs build:pro
node .yarn/releases/yarn-4.14.1.cjs verify:dist
```

Authenticated access is required to clone the private repository. The unpacked MV3 build is written to `dist/`. To rebuild and package the current MV3 version as a root-level ZIP, run:

```bash
node .yarn/releases/yarn-4.14.1.cjs pub --yes
node .yarn/releases/yarn-4.14.1.cjs verify:dist
unzip -t hippo-wallet-v0.93.105-hippo.8-mv3.zip
sha256sum hippo-wallet-v0.93.105-hippo.8-mv3.zip
```

Run the scanner, ZIP integrity test and checksum after `pub` because the packer performs a fresh production build. It reapplies the package version to each source manifest and currently expands compact JSON arrays as a formatting side effect. Inspect and restore formatting-only manifest changes before committing.

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

Hippo Wallet remains a downstream Rabby fork. Upstream copyright and license notices are retained. See [LICENSE](LICENSE) and [brand and font notices](docs/brand-and-font-notices.md).

The reports under [`audits/`](audits/) cover historical upstream Rabby releases; they do not attest to the Hippo-specific 2026 changes.
