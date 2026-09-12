/**
 * @jest-environment node
 */
// Process-level mutants for gpt56 round-3 blocker B6: the packaged-artifact
// verifier's FAILURE paths must (a) exit nonzero for a missing marker and a
// duplicated WalletConnect marker, and (b) never leak the raw WalletConnect
// project id into stdout or stderr — failures are reported by label, length,
// and digest only.

import { execFileSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const repo = path.resolve(__dirname, '../..');
const verifier = path.join(repo, 'scripts/verify-cowswap-dist.js');

const brandSource = fs.readFileSync(
  path.join(repo, 'src/constant/hippo-brand.ts'),
  'utf8'
);
const wcMatch = brandSource.match(
  /HIPPO_WALLETCONNECT_PROJECT_ID\s*=\s*\n?\s*'([0-9a-fA-F]+)'/
);
const WC_MARKER = wcMatch ? wcMatch[1] : '';
if (!WC_MARKER) throw new Error('WC marker not found in hippo-brand.ts');
const wcDigest = crypto
  .createHash('sha256')
  .update(WC_MARKER)
  .digest('hex')
  .slice(0, 16);

const buildFixture = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-cow-fixture-'));
  const write = (rel: string, content: string) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  };

  write(
    'manifest.json',
    JSON.stringify({
      manifest_version: 3,
      version: '0.94.8',
      version_name: '0.94.8-hippo.13',
      action: { default_title: 'Hippo Wallet' },
      homepage_url: 'https://github.com/CWinthorpe/hippo-wallet',
      externally_connectable: { ids: [] },
      content_scripts: [
        { matches: ['*://connect.trezor.io/*/popup.html*'], js: [] },
      ],
      permissions: ['scripting'],
    })
  );

  const cowEndpoints = [
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
  ];
  write(
    'background.js',
    [
      `const wcProjectId = "${WC_MARKER}";`,
      `const endpoints = ${JSON.stringify(cowEndpoints)};`,
      'const settlement = "0x9008d19f58aabd9ed0d60971565aa8510560ab41";',
      'const settlementGnosis = "0xc92e8bdf79f0507f65a392b0ab4667716bfe0110";',
      'const vaultRelayer = "0xba3cb449bd2b4adddbc894d8697f5170800eadec";',
      'const sdkBrand = "Gnosis Protocol";',
      'const sdkVersion = "1.15.0";',
      'export default { wcProjectId, endpoints };',
    ].join('\n')
  );
  write('ui.js', 'console.log("hippo ui");');
  write('sw.js', 'console.log("hippo sw");');
  write('offscreen.html', '<html></html>');
  write('trezor-usb-permissions.html', '<html></html>');
  write('vendor/trezor/trezor-content-script.js', '// trezor');
  write('vendor/trezor-usb-permissions.js', '// trezor');
  write(
    'rules/privacy.json',
    JSON.stringify([
      {
        id: 1,
        action: { type: 'block' },
        condition: { regexFilter: 'debank' },
      },
    ])
  );
  return root;
};

const runVerifier = (root: string) => {
  try {
    const stdout = execFileSync('node', [verifier, root, repo], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e: any) {
    return {
      code: e.status ?? -1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
};

describe('cowswap dist verifier failure paths (B6)', () => {
  test('pristine fixture passes and reports the WC marker by digest only', () => {
    const root = buildFixture();
    const result = runVerifier(root);
    expect(result.code).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.ok).toBe(true);
    expect(report.walletConnectMarker.sha256_16).toBe(wcDigest);
    expect(report.walletConnectMarker.exactlyOnce).toBe(true);
    // Even the success payload must not carry the raw value.
    expect(result.stdout).not.toContain(WC_MARKER);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('missing WC marker: nonzero exit, raw marker absent from stdout AND stderr', () => {
    const root = buildFixture();
    const bg = path.join(root, 'background.js');
    const mutated = fs
      .readFileSync(bg, 'utf8')
      .replace(
        `const wcProjectId = "${WC_MARKER}";`,
        'const wcProjectId = "";'
      );
    fs.writeFileSync(bg, mutated);

    const result = runVerifier(root);
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    // The leak the round-3 audit caught: raw collected marker interpolated
    // into the thrown error. Must be gone; the digest label must be present.
    expect(combined).not.toContain(WC_MARKER);
    expect(combined).toContain(`walletconnect#${wcDigest}`);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('duplicated WC marker: nonzero exit, raw marker absent', () => {
    const root = buildFixture();
    const bg = path.join(root, 'background.js');
    fs.appendFileSync(bg, `\nconst alsoHere = "${WC_MARKER}";\n`);

    const result = runVerifier(root);
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).not.toContain(WC_MARKER);
    expect(combined).toContain(`walletconnect#${wcDigest}`);
    expect(combined).toMatch(/exactly once/);
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('every required marker reported missing is label+digest only (no raw values)', () => {
    const root = buildFixture();
    // Wipe the runtime file carrying every required marker.
    fs.writeFileSync(path.join(root, 'background.js'), 'export default {};');

    const result = runVerifier(root);
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).not.toContain(WC_MARKER);
    // Public CoW markers may be named; the secret must not be.
    expect(combined).toContain('cow-mainnet');
    expect(combined).toContain(`walletconnect#${wcDigest}`);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
