# Hippo Wallet

Hippo Wallet is a privacy-hardened, self-hosted browser wallet derived from [Rabby Wallet](https://github.com/RabbyHub/Rabby). It keeps Rabby's transaction simulation and account tooling while removing product analytics, crash reporting, automatic security-action telemetry, and Rabby-controlled default RPC routing.

## Current release

- **Version:** `0.93.101-hippo.2`
- **Target:** Chromium Manifest V3
- **Repository:** [CWinthorpe/hippo-wallet](https://github.com/CWinthorpe/hippo-wallet)

Use the ZIP attached to the [latest GitHub release](https://github.com/CWinthorpe/hippo-wallet/releases/latest). Release notes include the SHA-256 digest; verify it before installation.

## Privacy changes

- Product analytics adapters are local no-ops.
- GA4, Matomo, Sentry initialization, uninstall reporting, rating prompts, and onboarding opt-in behavior are disabled.
- Automatic `/v1/engine/action/log` reporting is removed from transaction, message, and typed-data approval flows.
- The action-log API is also disabled at the API-client boundary and blocked by a Manifest V3 declarative network rule.
- Rabby's `/v1/chainrpc` and `/v1/wallet/eth_rpc` control-plane paths are disabled at the API-client boundary and blocked by declarative network rules.
- Persistent per-installation Rabby API identifiers are cleared and cannot be re-enabled by normal runtime mutation.
- No Hippo-operated relay or telemetry server is used.

This does **not** mean the wallet makes no network requests. Portfolio, history, simulation, phishing, token metadata, gasless, gas-account, swap, bridge, and other enhanced features still use their functional upstream APIs. Those services may receive addresses, origins, transaction data, or signed payloads required to perform the requested operation. See [docs/private-fork.md](docs/private-fork.md) for the exact trust boundary.

## Default RPC routing

Hippo no longer downloads its RPC routing table from Rabby and no longer uses Rabby's generic `/v1/wallet/eth_rpc` proxy. The built-in map is versioned with the source and can be audited at [`src/constant/default-rpc-providers.json`](src/constant/default-rpc-providers.json).

Routing order:

1. User-configured custom primary RPC.
2. User-configured custom fallback RPCs for replay-safe reads and estimates.
3. Otherwise, a built-in 1RPC endpoint.
4. dRPC if 1RPC is unavailable, rate-limited, malformed, or not present for that chain.
5. PublicNode, then 0xRPC, where listed and applicable.

Automatic failover is **sequential**, not parallel. It applies only to stateless reads and estimates after transport failures, documented quota/rate-limit responses, selected server failures, or malformed RPC results. Semantic failures such as an execution revert are returned immediately.

Ordinary signed transaction submission uses exactly one endpoint: the custom broadcast endpoint when configured, otherwise the first built-in endpoint. Hippo does not automatically replay a signed transaction to another provider after an ambiguous failure. Gasless, gas-account, and explicitly selected MEV-protected flows remain backend-assisted because those features require sponsorship or private-orderflow coordination.

The reviewed map currently provides built-in routes for **67 of 86** bundled networks. These 19 networks require a custom RPC:

- Oasys
- Conflux
- Story
- Reya
- Botanix
- Citrea
- IoTeX
- BounceBit
- Cyber
- Etherlink
- Zircuit
- Sophon
- DFK Chain
- Chiliz
- Mitosis
- Taiko
- Bitlayer
- DBK Chain
- Plasma

Existing custom RPC profiles are preserved during upgrade.

## Provider privacy boundary

The provider order reflects availability and stated privacy characteristics, not independent proof:

- [1RPC](https://docs.1rpc.io/using-the-web3-api/networks) states that its public relay discards identifying metadata and uses privacy-preserving relay infrastructure.
- [dRPC](https://drpc.org/chainlist) provides broad coverage; its published privacy policy permits temporary IP processing/logging for routing and rate limiting.
- [PublicNode](https://www.publicnode.com/privacy) states that operational IP data may be retained for up to 24 hours.
- [0xRPC](https://0xrpc.io/) states that raw IP addresses are not logged.

The extension embeds no paid-provider credentials. A VPN user exposes the VPN exit address—not the residential address—to whichever RPC provider actually receives the request. Sequential failover can disclose the same read request to a later provider only after the previous endpoint fails.

## Install the release ZIP

1. Download the MV3 ZIP from [GitHub Releases](https://github.com/CWinthorpe/hippo-wallet/releases).
2. Verify its SHA-256 digest against the release notes.
3. Extract the ZIP.
4. Open `chrome://extensions` or the equivalent Chromium extension page.
5. Enable **Developer mode**.
6. Select **Load unpacked** and choose the extracted directory.

Back up seed phrases and private keys before replacing any wallet installation. Treat this as security-sensitive software, not a toy.

## Build from source

Prerequisites:

- Node.js 22
- The repository-pinned Yarn 4 release

```bash
git clone https://github.com/CWinthorpe/hippo-wallet.git
cd hippo-wallet
node .yarn/releases/yarn-4.14.1.cjs install --immutable
node .yarn/releases/yarn-4.14.1.cjs build:pro
```

The unpacked MV3 build is written to `dist/`.

Focused privacy and routing tests:

```bash
node .yarn/releases/yarn-4.14.1.cjs test \
  __tests__/background/defaultRPCProviders.test.ts \
  __tests__/background/rpcService.test.ts \
  __tests__/background/openapiPrivacy.test.ts \
  __tests__/privacy/privateBuildPrivacy.test.ts \
  --runInBand --no-cache
```

## Upstream and license

Hippo Wallet remains a downstream Rabby fork. Upstream copyright and license notices are retained. See [LICENSE](LICENSE), [NOTICE](NOTICE), and [docs/private-fork.md](docs/private-fork.md).
