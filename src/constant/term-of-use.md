# Hippo Wallet Software Notice

**Last updated: August 1, 2026**

Hippo Wallet is self-custodial, open-source wallet software distributed under the MIT License. It is a private fork, not a hosted financial service, custodian, broker, exchange, or investment adviser.

# Self-custody

- Your seed phrase, private keys, passwords, and signing decisions remain your responsibility.
- Hippo Wallet cannot recover a lost password, seed phrase, private key, or inaccessible address.
- Anyone with your seed phrase or private key can control the associated assets.
- Verify transaction details, contract addresses, networks, RPC endpoints, and approval scopes before signing.

# Privacy

Telemetry, crash reporting, behavioral analytics, uninstall reporting, rating telemetry, and persistent installation identifiers are disabled by construction in this fork.

Hippo Wallet still makes functional network requests when required to provide wallet features. Depending on the feature you use, those requests may reach:

- RPC endpoints selected or configured by you;
- wallet APIs used for balances, metadata, transaction simulation, chain discovery, assets, and security checks;
- asset and security services;
- WalletConnect/Reown relay infrastructure;
- third-party dapps, bridges, swaps, lending interfaces, hardware-wallet bridges, and other services you explicitly open or use.

These third parties have their own availability, security, logging, and privacy practices. Using a custom RPC does not redirect every non-RPC wallet feature through that endpoint.

# Software and network risk

Blockchain transactions are generally irreversible. Smart contracts, tokens, bridges, RPC providers, dapps, hardware-wallet software, browser extensions, and network services may contain defects or malicious behavior. You assume the risk of using the software and any connected third-party service.

# License and warranty

The source license and upstream attribution are preserved in the repository's `LICENSE` file. The software is provided **as is**, without warranty, consistent with the MIT License.

# Project information

Source, privacy architecture, functional-traffic disclosures, and release artifacts are maintained in the private project repository:

[github.com/CWinthorpe/hippo-wallet](https://github.com/CWinthorpe/hippo-wallet)
