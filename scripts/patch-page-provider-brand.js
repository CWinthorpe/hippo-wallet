const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageRoot = path.join(
  root,
  'node_modules',
  '@rabby-wallet',
  'page-provider'
);
const icon = fs
  .readFileSync(path.join(root, '_raw/images/hippo-wallet-mark.svg'))
  .toString('base64');
const metadata = `name: "Hippo Wallet",
$1icon: "data:image/svg+xml;base64,${icon}",
$2rdns: "finance.resupply.hippo-wallet"`;

function requireContains(text, fragment, relative) {
  if (!text.includes(fragment)) {
    throw new Error(`Hippo page-provider patch failed for ${relative}: ${fragment}`);
  }
}

for (const relative of ['src/index.ts', 'dist/index.js']) {
  const file = path.join(packageRoot, relative);
  let text = fs.readFileSync(file, 'utf8');
  text = text.replace(
    /name: "(?:Rabby|Hippo) Wallet",\n(\s*)icon: "data:image\/svg\+xml;base64,[^"]+",\n(\s*)rdns: "(?:io\.rabby|finance\.resupply\.hippo-wallet)"/,
    metadata
  );
  text = text.replaceAll(
    'event.detail.info.rdns === "io.rabby"',
    'event.detail.info.rdns === "finance.resupply.hippo-wallet"'
  );

  if (relative.startsWith('src/')) {
    if (!text.includes('isHippo? = true;')) {
      text = text.replace(
        '  isRabby? = true;\n  isMetaMask = true;\n  _isRabby = true;',
        '  isRabby? = true;\n  isHippo? = true;\n  isMetaMask = true;\n  _isRabby = true;\n  _isHippo = true;'
      );
      text = text.replace(
        '      delete this.isRabby;\n',
        '      delete this.isRabby;\n      delete this.isHippo;\n'
      );
      text = text.replace(
        '["on", "isRabby", "isMetaMask", "_isRabby"]',
        '["on", "isRabby", "isHippo", "isMetaMask", "_isRabby", "_isHippo"]'
      );
      text = text.replace(
        '  delete rabbyEthereumProvider.isRabby;\n  rabbyProvider.isMetaMask = true;\n  delete rabbyProvider.isRabby;',
        '  delete rabbyEthereumProvider.isRabby;\n  delete rabbyEthereumProvider.isHippo;\n  rabbyProvider.isMetaMask = true;\n  delete rabbyProvider.isRabby;\n  delete rabbyProvider.isHippo;'
      );
    }
    if (!text.includes('window.hippo = rabbyProvider;')) {
      text = text.replace(
        '  window.rabby = rabbyProvider;\n',
        '  window.rabby = rabbyProvider;\n  window.hippo = rabbyProvider;\n'
      );
    }
    if (!text.includes('Object.defineProperty(window, "hippo"')) {
      text = text.replace(
        '  Object.defineProperty(window, "rabby", {\n    value: rabbyProvider,\n    configurable: false,\n    writable: false,\n  });\n',
        '  Object.defineProperty(window, "rabby", {\n    value: rabbyProvider,\n    configurable: false,\n    writable: false,\n  });\n  Object.defineProperty(window, "hippo", {\n    value: rabbyProvider,\n    configurable: false,\n    writable: false,\n  });\n'
      );
    }
  } else {
    if (!text.includes('this.isHippo = true;')) {
      text = text.replace(
        '        this.isRabby = true;\n        this.isMetaMask = true;\n        this._isRabby = true;',
        '        this.isRabby = true;\n        this.isHippo = true;\n        this.isMetaMask = true;\n        this._isRabby = true;\n        this._isHippo = true;'
      );
      text = text.replace(
        '            delete this.isRabby;\n',
        '            delete this.isRabby;\n            delete this.isHippo;\n'
      );
      text = text.replace(
        '["on", "isRabby", "isMetaMask", "_isRabby"]',
        '["on", "isRabby", "isHippo", "isMetaMask", "_isRabby", "_isHippo"]'
      );
      text = text.replace(
        '    delete rabbyEthereumProvider.isRabby;\n    rabbyProvider.isMetaMask = true;\n    delete rabbyProvider.isRabby;',
        '    delete rabbyEthereumProvider.isRabby;\n    delete rabbyEthereumProvider.isHippo;\n    rabbyProvider.isMetaMask = true;\n    delete rabbyProvider.isRabby;\n    delete rabbyProvider.isHippo;'
      );
    }
    if (!text.includes('window.hippo = rabbyProvider;')) {
      text = text.replace(
        '    window.rabby = rabbyProvider;\n',
        '    window.rabby = rabbyProvider;\n    window.hippo = rabbyProvider;\n'
      );
    }
    if (!text.includes('Object.defineProperty(window, "hippo"')) {
      text = text.replace(
        '    Object.defineProperty(window, "rabby", {\n        value: rabbyProvider,\n        configurable: false,\n        writable: false,\n    });\n',
        '    Object.defineProperty(window, "rabby", {\n        value: rabbyProvider,\n        configurable: false,\n        writable: false,\n    });\n    Object.defineProperty(window, "hippo", {\n        value: rabbyProvider,\n        configurable: false,\n        writable: false,\n    });\n'
      );
    }
  }

  requireContains(text, 'name: "Hippo Wallet"', relative);
  requireContains(text, 'rdns: "finance.resupply.hippo-wallet"', relative);
  requireContains(text, 'isHippo', relative);
  requireContains(text, '"hippo"', relative);
  fs.writeFileSync(file, text);
}

console.log('Applied Hippo Wallet page-provider branding');

const trezorFile = path.join(
  root,
  'node_modules',
  '@rabby-wallet',
  'eth-trezor-keyring',
  'dist',
  'index.js'
);
let trezorSource = fs.readFileSync(trezorFile, 'utf8');
trezorSource = trezorSource
  .replaceAll('support@rabby.io', 'cwinthorpe@users.noreply.github.com')
  .replaceAll("appName: 'Rabby Wallet'", "appName: 'Hippo Wallet'")
  .replaceAll(
    "appUrl: 'https://rabby.io/'",
    "appUrl: 'https://github.com/CWinthorpe/hippo-wallet'"
  );
requireContains(trezorSource, "appName: 'Hippo Wallet'", 'Trezor keyring');
if (trezorSource.includes("appName: 'Rabby Wallet'")) {
  throw new Error('Hippo Trezor dependency branding patch did not apply');
}
fs.writeFileSync(trezorFile, trezorSource);

console.log('Applied Hippo Wallet dependency branding');
