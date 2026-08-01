const path = require('path');
const { prompt, BooleanPrompt } = require('enquirer');
const fs = require('fs-extra');
const shell = require('shelljs');
const pkg = require('../package.json');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const YARN_CLI = path.resolve(PROJECT_ROOT, '.yarn/releases/yarn-4.14.1.cjs');
const args = process.argv.slice(2);
const isYesMode = args.includes('--yes') || args.includes('-y');

const shellQuote = (value) =>
  `"${String(value).replace(/(["\\$`])/g, '\\$1')}"`;

function execOrThrow(command) {
  const result = shell.exec(command);
  if (result.code !== 0) {
    throw new Error(`[Hippo] Command failed: ${command}`);
  }
}

function updateManifestVersion(
  version,
  manifestType,
  filename = 'manifest.json'
) {
  const manifestPath = path.resolve(
    PROJECT_ROOT,
    'src/manifest',
    manifestType,
    filename
  );
  const manifest = fs.readJSONSync(manifestPath);
  manifest.version = version;
  fs.writeJSONSync(manifestPath, manifest, { spaces: 2 });
}

function removeSourceMaps(distDir) {
  shell
    .find(distDir)
    .filter((filePath) => filePath.endsWith('.map'))
    .forEach((filePath) => fs.removeSync(filePath));
}

async function getBundleOptions() {
  const oldVersion = pkg.version;
  const plus1Version = oldVersion
    .split('.')
    .map((value, index) => (index === 2 ? Number(value) + 1 : value))
    .join('.');

  if (isYesMode) {
    console.log(
      `[Hippo] Running in --yes mode: version=${oldVersion}, MV3=y, debug=n`
    );
    return {
      version: oldVersion,
      isMV3: true,
      isDebug: false,
    };
  }

  const { version } = await prompt({
    type: 'input',
    name: 'version',
    message: '[Hippo] Please input the release version:',
    initial: plus1Version,
  });

  const isMV3 = await new BooleanPrompt({
    message: '[Hippo] Do you want to build MV3? (y/N)',
  }).run();

  const isDebug = await new BooleanPrompt({
    message: '[Hippo] Do you want to build a debug version? (y/N)',
  }).run();

  return { version, isMV3, isDebug };
}

async function bundle() {
  const options = await getBundleOptions();
  const { version, isMV3, isDebug } = options;
  const buildScript = isDebug ? 'build:debug' : 'build:pro';
  const distDir = path.resolve(PROJECT_ROOT, isMV3 ? 'dist' : 'dist-mv2');

  updateManifestVersion(version, 'chrome-mv3');
  updateManifestVersion(version, 'chrome-mv3', 'manifest.dev.json');
  updateManifestVersion(version, 'chrome-mv2');
  updateManifestVersion(version, 'firefox-mv2');

  const script = isMV3 ? buildScript : `${buildScript}:mv2`;
  execOrThrow(`node ${shellQuote(YARN_CLI)} ${script}`);
  removeSourceMaps(distDir);
  return options;
}

async function pack({ version, isMV3, isDebug }) {
  const { createZipTask } = await import('./zip.mjs');
  const target = isMV3 ? 'dist/**' : 'dist-mv2/**';
  const manifest = fs.readJSONSync(
    path.resolve(
      PROJECT_ROOT,
      'src/manifest',
      isMV3 ? 'chrome-mv3' : 'firefox-mv2',
      'manifest.json'
    )
  );
  const releaseLabel = manifest.version_name || version;
  const filename = `hippo-wallet-v${releaseLabel}${isDebug ? '-debug' : ''}-${
    isMV3 ? 'mv3' : 'mv2'
  }.zip`;
  await createZipTask(target, filename);
  console.log(`[Hippo] Created ${filename}`);
}

bundle()
  .then(pack)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
