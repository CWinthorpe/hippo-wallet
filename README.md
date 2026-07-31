# Hippo Wallet

![Hippo Wallet](./src/ui/assets/hippo-wallet-logo.svg)

Hippo Wallet is a privacy-focused, self-custodial browser wallet for DeFi. It is based on the MIT-licensed Rabby Wallet codebase and carries the required upstream copyright notice in [`LICENSE`](./LICENSE).

## What is different

- Original Hippo Wallet name, icon family, wordmark, and Resupply-inspired visual system.
- Pixel Operator display typography and IBM Plex Mono interface typography.
- Behavioral analytics, crash reporting, uninstall metrics, rating telemetry, and persistent installation identifiers disabled by construction.
- One primary RPC plus ordered replay-safe read fallbacks per chain.
- One explicitly selected signed-transaction broadcast RPC with no retry, fan-out, or automatic backend fallback.
- Direct `eth_chainId` validation for every configured RPC endpoint.
- WalletConnect/Reown configured only from an operator-owned build-time project ID.

Read [`docs/private-fork.md`](./docs/private-fork.md) before using the wallet. It separates removed telemetry from functional API, RPC, asset/security-service, and Reown traffic that remains necessary for wallet features.

## Install

Download the latest private MV3 release from:

<https://github.com/CWinthorpe/hippo-wallet/releases/latest>

Extract the ZIP, open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select the extracted folder.

## Build

Requirements:

- Node.js 22+
- the vendored Yarn 4 release in `.yarn/releases/`
- an operator-owned Reown project ID for WalletConnect pairing

```bash
node .yarn/releases/yarn-4.14.1.cjs install --check-cache
WALLETCONNECT_PROJECT_ID='<your Reown project id>' \
  node .yarn/releases/yarn-4.14.1.cjs build:pro
```

The unpacked MV3 extension is written to `dist/`.

## Verify

```bash
node .yarn/releases/yarn-4.14.1.cjs check
node .yarn/releases/yarn-4.14.1.cjs test --runInBand
```

Brand assets can be regenerated with:

```bash
python3 scripts/generate-hippo-brand-assets.py
```

That optional asset-generation step requires Pillow and fontTools. The editable indexed source is [`brand/hippo-wallet-icon.aseprite`](./brand/hippo-wallet-icon.aseprite).

## Architecture

The extension retains the upstream background, content-script, page-provider, and shared UI architecture. Internal `rabby` storage keys, package namespaces, compatibility flags, and upstream API identifiers are intentionally retained where changing them would corrupt existing wallet state or break protocol compatibility. They are not the user-facing product identity.

## Privacy and functional traffic

See:

- [`docs/private-fork.md`](./docs/private-fork.md)
- [`docs/brand-and-font-notices.md`](./docs/brand-and-font-notices.md)

## License

The software remains distributed under the MIT License. See [`LICENSE`](./LICENSE). Third-party font notices are documented separately.
