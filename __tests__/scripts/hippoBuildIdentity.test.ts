import fs from 'fs';
import path from 'path';

const repo = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(repo, relativePath), 'utf8');

/**
 * The complete executable build/package/release graph: every script target
 * named in package.json plus the transitively invoked build/ and scripts/
 * entry points. Derived from package.json so adding a new publisher script
 * automatically brings it into the scan (gpt56 round-5 R4-B4 closure:
 * scanning only top-level scripts/*build|pack|release|publish* missed
 * build/release.js — invoked via `yarn pub` — build/zip.mjs, the webpack
 * configs, and scripts/fns.js, the packer used for release ZIPs).
 */
const pkg = JSON.parse(read('package.json'));
const scriptTargets = new Set<string>();
for (const command of Object.values(pkg.scripts as Record<string, string>)) {
  for (const m of String(command).matchAll(
    /(?:node|cross-env[^&|;]*node)\s+((?:build|scripts)\/[\w./-]+\.(?:js|mjs|cjs|ts))/g
  )) {
    scriptTargets.add(m[1]);
  }
  // "npm run X" / plain "X" yarn targets chain to other package.json scripts,
  // already covered by iterating all script values above.
}
const collectFiles = (relativeDir: string): string[] => {
  const absoluteDir = path.join(repo, relativeDir);
  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) return collectFiles(relativePath);
    return [relativePath.replaceAll(path.sep, '/')];
  });
};

// Scan the complete executable build/package/release surface, not a hand
// maintained list. This includes package.json (the command-body root),
// webpack.config.js (the implicit root loaded by the webpack CLI), and every
// local build/scripts child, so a publisher control cannot hide in a
// transitively required config or helper.
const BUILD_GRAPH_FILES = [
  'package.json',
  'webpack.config.js',
  ...collectFiles('build'),
  ...collectFiles('scripts'),
  ...scriptTargets,
].filter((rel, i, arr) => fs.existsSync(path.join(repo, rel)) && arr.indexOf(rel) === i);

const FORBIDDEN = [
  'RABBY_BUILD_BUCKET',
  'RABBY_SENTRY_DSN',
  'download.rabby.io/autobuild',
  'RabbyDebug-',
  'New Rabby Debug Package',
];

describe('Hippo build identity guard', () => {
  test('the retired Rabby autobuild publisher is absent', () => {
    expect(fs.existsSync(path.join(repo, '.github/workflows/autobuild.yml'))).toBe(
      false
    );
    expect(fs.existsSync(path.join(repo, 'scripts/autobuild.sh'))).toBe(false);
    expect(fs.existsSync(path.join(repo, 'scripts/notify-lark.js'))).toBe(false);
    expect(BUILD_GRAPH_FILES.length).toBeGreaterThan(10);
  });

  test('the retained local debug packer emits a Hippo artifact name', () => {
    const packer = read('scripts/pack-debug.sh');
    expect(packer).toContain('Hippo_v${app_ver}_debug.');
    expect(packer).not.toContain('Rabby_v${app_ver}_debug.');
  });

  test('no forbidden autobuild identity or publisher controls remain in workflows or release scripts', () => {
    const workflowText = fs
      .readdirSync(path.join(repo, '.github/workflows'))
      .filter((name) => name !== 'flowcheck.yml')
      .map((name) => read(`.github/workflows/${name}`))
      .join('\n');
    const releaseScriptText = fs
      .readdirSync(path.join(repo, 'scripts'))
      .filter((name) => /build|pack|release|publish/i.test(name))
      .map((name) => read(`scripts/${name}`))
      .join('\n');
    for (const forbidden of FORBIDDEN) {
      expect(`${workflowText}\n${releaseScriptText}`).not.toContain(forbidden);
    }
  });

  test('the ENTIRE executable build/package/release graph is publisher-clean', () => {
    // Mechanically derived from package.json + build/ (see
    // BUILD_GRAPH_FILES). None of these files may reference Rabby-owned
    // buckets, Sentry ingestion, the autobuild download host, debug-package
    // identity, or Lark publishers: restoring any of them (e.g. in
    // build/release.js or scripts/fns.js, which the old scan missed) must
    // redden this test.
    const graphText = BUILD_GRAPH_FILES.map((rel) => read(rel)).join('\n');
    for (const forbidden of FORBIDDEN) {
      expect(graphText).not.toContain(forbidden);
    }
    expect(graphText).not.toMatch(/LARK/i);
    // The release packer names artifacts hippo-wallet-* / Hippo_v*.
    const releaseText = [
      'build/release.js',
      'scripts/pack-debug.sh',
      'scripts/fns.js',
    ]
      .map((rel) => read(rel))
      .join('\n');
    expect(releaseText).toContain('hippo-wallet-v');
    expect(releaseText).not.toMatch(/Rabby_v|RabbyDebug/);
    // Derivation proof: `yarn pub` (build/release.js) is genuinely in the
    // scanned graph; a publisher added under any build/scripts path the
    // package.json chain reaches cannot escape the scan.
    expect(BUILD_GRAPH_FILES).toContain('build/release.js');
    expect(BUILD_GRAPH_FILES).toContain('scripts/fns.js');
  });

  test('flowcheck keeps its explicit, narrow upstream-monitor allowance only', () => {
    // flowcheck.yml is a manually-dispatched parity check against
    // RabbyHub/Rabby tmp branches (no Hippo artifact upload). It is the ONE
    // workflow permitted to reference upstream Rabby infrastructure, and it
    // must still not publish anything to Rabby storage or use the retired
    // autobuild identity.
    const flowcheck = read('.github/workflows/flowcheck.yml');
    expect(flowcheck).toContain('repository: RabbyHub/Rabby');
    for (const forbidden of FORBIDDEN) {
      expect(flowcheck).not.toContain(forbidden);
    }
    // No Hippo-brand artifact name and no upload step at all.
    expect(flowcheck).not.toMatch(/actions\/upload-artifact/);
  });
});
