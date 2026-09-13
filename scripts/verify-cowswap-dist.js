const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || 'dist');
const repo = path.resolve(process.argv[3] || '.');

const fail = (message) => {
  throw new Error(`FAIL: ${message}`);
};

if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
  fail(`missing artifact directory: ${root}`);
}

const manifestPath = path.join(root, 'manifest.json');
if (!fs.existsSync(manifestPath)) fail('missing manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest.manifest_version !== 3) fail('manifest is not MV3');
if (manifest.version !== '0.94.8') fail('unexpected manifest version');
if (manifest.version_name !== '0.94.8-hippo.13') {
  fail('unexpected manifest version_name');
}
if (manifest.action?.default_title !== 'Hippo Wallet') {
  fail('Hippo action title missing');
}
if (manifest.homepage_url !== 'https://github.com/CWinthorpe/hippo-wallet') {
  fail('unexpected homepage URL');
}
if (JSON.stringify(manifest.externally_connectable?.ids) !== '[]') {
  fail('externally_connectable must be closed');
}
if (
  !manifest.content_scripts?.some((entry) =>
    entry.matches?.includes('*://connect.trezor.io/*/popup.html*')
  )
) {
  fail('restricted Trezor popup content-script match is missing');
}
const permissions = new Set(manifest.permissions || []);
if (!permissions.has('scripting')) fail('scripting permission missing');
for (const forbidden of ['webRequest', 'webRequestBlocking', 'debugger']) {
  if (permissions.has(forbidden))
    fail(`forbidden permission present: ${forbidden}`);
}

const requiredFiles = [
  'background.js',
  'ui.js',
  'sw.js',
  'offscreen.html',
  'trezor-usb-permissions.html',
  'vendor/trezor/trezor-content-script.js',
  'vendor/trezor-usb-permissions.js',
  'rules/privacy.json',
];
for (const name of requiredFiles) {
  if (!fs.existsSync(path.join(root, name)))
    fail(`missing required file: ${name}`);
}

const files = [];
const walk = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) fail(`symlink in artifact: ${relative}`);
    if (relative === '_metadata' || relative.startsWith('_metadata/')) {
      fail('Chrome _metadata directory present');
    }
    if (stat.isDirectory()) walk(absolute);
    else if (stat.isFile()) files.push({ absolute, relative });
  }
};
walk(root);
if (!files.length) fail('artifact is empty');

for (const { relative } of files) {
  const extension = path.extname(relative).toLowerCase();
  if (
    extension === '.map' ||
    ['.pem', '.key'].includes(extension) ||
    ['.env', '.env.local'].includes(path.basename(relative))
  ) {
    fail(`forbidden artifact file: ${relative}`);
  }
}

const runtimeFiles = files.filter(({ relative }) =>
  ['.js', '.html', '.css'].includes(path.extname(relative).toLowerCase())
);
const requiredMarkers = [
  'fc0e0867d8540f1d7df27c322976534d',
  'https://api.cow.fi/mainnet',
  'https://api.cow.fi/xdai',
  'https://api.cow.fi/arbitrum_one',
  'https://api.cow.fi/base',
  'https://api.cow.fi/avalanche',
  'https://api.cow.fi/polygon',
  'https://api.cow.fi/linea',
  'https://api.cow.fi/bnb',
  'https://api.cow.fi/plasma',
  'https://api.cow.fi/ink',
  '0x9008d19f58aabd9ed0d60971565aa8510560ab41',
  '0xc92e8bdf79f0507f65a392b0ab4667716bfe0110',
  '0xba3cb449bd2b4adddbc894d8697f5170800eadec',
  'Gnosis Protocol',
  '1.15.0',
];
const requiredFound = Object.fromEntries(
  requiredMarkers.map((item) => [item, false])
);
const retiredName = ['l', 'l', 'a', 'm', 'a', 's', 'w', 'a', 'p'].join('');
const forbiddenMarkers = [
  ['defi', 'llama'].join(''),
  retiredName,
  ['dex', 'Aggregator', 'Quote'].join(''),
  'tx-relay/v1/swap/quote',
  'api.0x.org/gasless',
  '0x Gasless',
  '-----BEGIN PRIVATE KEY-----',
  '-----BEGIN RSA PRIVATE KEY-----',
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  'sourceMappingURL=data:application/json;base64,ey',
];
for (const { absolute, relative } of runtimeFiles) {
  const text = fs.readFileSync(absolute, 'utf8');
  const lower = text.toLowerCase();
  for (const marker of requiredMarkers) {
    if (lower.includes(marker.toLowerCase())) requiredFound[marker] = true;
  }
  for (const marker of forbiddenMarkers) {
    if (lower.includes(marker.toLowerCase())) {
      fail(`forbidden runtime marker in ${relative}`);
    }
  }
}
const missingMarkers = Object.entries(requiredFound)
  .filter(([, found]) => !found)
  .map(([marker]) => marker);
if (missingMarkers.length) {
  fail(`required CoW runtime markers missing: ${missingMarkers.join(', ')}`);
}

const rules = JSON.parse(
  fs.readFileSync(path.join(root, 'rules/privacy.json'), 'utf8')
);
if (!Array.isArray(rules) || !rules.length) fail('privacy DNR rules are empty');
if (rules.some((rule) => rule.action?.type !== 'block')) {
  fail('privacy DNR contains a non-block action');
}

const packageJson = JSON.parse(
  fs.readFileSync(path.join(repo, 'package.json'), 'utf8')
);
if (packageJson.dependencies?.['@cowprotocol/sdk-config']) {
  fail(
    'CoW protocol addresses must remain explicit rather than dependency-owned'
  );
}
if (packageJson.dependencies?.['@cowprotocol/sdk-order-book']) {
  fail('order-book SDK with its unrestricted fetch client must not be bundled');
}
const removedPaths = [
  `src/background/service/${retiredName}.ts`,
  `src/background/service/${retiredName}QuoteTransport.ts`,
  `src/constant/${retiredName.replace('swap', '-swap')}.ts`,
  `scripts/${retiredName}-packaged-smoke.js`,
];
for (const relative of removedPaths) {
  if (fs.existsSync(path.join(repo, relative)))
    fail(`retired source remains: ${relative}`);
}

const leafHashes = [];
let totalBytes = 0;
for (const { absolute, relative } of files.sort((a, b) =>
  a.relative.localeCompare(b.relative)
)) {
  const data = fs.readFileSync(absolute);
  totalBytes += data.length;
  leafHashes.push(
    Buffer.concat([
      Buffer.from(relative),
      Buffer.from([0]),
      crypto.createHash('sha256').update(data).digest(),
    ])
  );
}
const treeSha256 = crypto
  .createHash('sha256')
  .update(
    Buffer.concat(
      leafHashes.map((item) => Buffer.concat([item, Buffer.from('\n')]))
    )
  )
  .digest('hex');

console.log(
  JSON.stringify(
    {
      ok: true,
      manifestVersion: manifest.manifest_version,
      versionName: manifest.version_name,
      fileCount: files.length,
      totalBytes,
      treeSha256,
      runtimeFilesScanned: runtimeFiles.length,
      requiredCowMarkers: requiredMarkers,
      privacyRuleCount: rules.length,
      sourceMaps: 0,
      symlinks: 0,
    },
    null,
    2
  )
);
