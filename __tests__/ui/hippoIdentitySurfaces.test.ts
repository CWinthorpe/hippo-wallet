import fs from 'fs';
import path from 'path';

// Release-audit round-1 blocker closure (gpt56 review, v0.94.11-hippo.16):
// B1 — the Rabby mobile-app destinations (com.debank.rabbymobile /
// rabby-wallet-crypto-evm) and Rabby social links (twitter.com/rabby_io /
// discord.gg invite) were reachable from the packaged UI through the
// SyncToMobile route, the Settings menu, and the Dashboard panel.
// B2 — .github/workflows/autobuild.yml + scripts/autobuild.sh could publish
// Rabby-branded artifacts to Rabby download infrastructure.
// These static guards pin the removals; the packaged counterparts live in
// scripts/verify-cowswap-dist.js forbidden runtime markers.

const RABBY_IDENTITY_STRINGS = [
  'com.debank.rabbymobile',
  'rabby-wallet-crypto-evm',
  'twitter.com/rabby_io',
  'discord.com/invite/seFBCWmUre',
];

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

const exists = (relativePath: string) =>
  fs.existsSync(path.join(process.cwd(), relativePath));

describe('Rabby mobile/social identity surfaces removed', () => {
  test('the SyncToMobile route, components, and shared constants are gone', () => {
    expect(exists('src/ui/utils/SyncToMobile')).toBe(false);
    expect(exists('src/ui/assets/sync-to-mobile')).toBe(false);
    expect(exists('src/constant/download.ts')).toBe(false);

    const mainRoute = readSource('src/ui/views/MainRoute.tsx');
    expect(mainRoute).not.toContain('SyncToMobile');
    expect(mainRoute).not.toContain('path="/sync"');
  });

  test('Settings and Dashboard no longer expose the mobile-sync entry', () => {
    const settings = readSource(
      'src/ui/views/Dashboard/components/Settings/index.tsx'
    );
    expect(settings).not.toContain("openInternalPageInTab('sync')");
    expect(settings).not.toContain('panel.mobile');
    expect(settings).not.toContain('followUs');

    const panel = readSource(
      'src/ui/views/Dashboard/components/DashboardPanel/index.tsx'
    );
    expect(panel).not.toContain("openInternalPageInTab('sync')");
    expect(panel).not.toContain('RcIconMobileSyncCC');
    expect(panel).not.toContain("'mobile'");

    expect(exists('src/ui/assets/dashboard/panel/mobile-sync-cc.svg')).toBe(
      false
    );
    expect(exists('src/ui/assets/settings/IconMobileSync-cc.svg')).toBe(false);
  });

  test('no Rabby app-store or social destination remains in UI sources', () => {
    for (const relative of [
      'src/ui/views/MainRoute.tsx',
      'src/ui/views/Dashboard/components/Settings/index.tsx',
      'src/ui/views/Dashboard/components/DashboardPanel/index.tsx',
    ]) {
      const source = readSource(relative);
      const offenders = RABBY_IDENTITY_STRINGS.filter((marker) =>
        source.includes(marker)
      );
      expect(`${relative}: ${offenders.join(', ')}`).toBe(`${relative}: `);
    }
  });

  test('the QR vault-export path backing the removed route is gone', () => {
    const wallet = readSource('src/background/controller/wallet.ts');
    expect(wallet).not.toContain('getSyncDataString');
    const keyring = readSource('src/background/service/keyring/index.ts');
    expect(keyring).not.toContain('getSyncVault');
    expect(keyring).not.toContain('filterKeyringData');
  });

  test('locale bundles carry no orphaned keys for the removed surfaces', () => {
    const localesDir = path.join(process.cwd(), '_raw/locales');
    const codes = fs
      .readdirSync(localesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(codes.length).toBeGreaterThan(0);

    for (const code of codes) {
      const raw = fs.readFileSync(
        path.join(localesDir, code, 'messages.json'),
        'utf8'
      );
      const data = JSON.parse(raw) as Record<string, any>;
      expect(data.page?.syncToMobile).toBeUndefined();
      expect(data.page?.dashboard?.settings?.followUs).toBeUndefined();
      expect(data.page?.dashboard?.home?.panel?.mobile).toBeUndefined();
      for (const marker of RABBY_IDENTITY_STRINGS) {
        expect(raw).not.toContain(marker);
      }
    }
  });
});

describe('Rabby-infrastructure autobuild publication removed', () => {
  test('the autobuild workflow and Rabby upload scripts do not exist', () => {
    expect(exists('.github/workflows/autobuild.yml')).toBe(false);
    expect(exists('scripts/autobuild.sh')).toBe(false);
    expect(exists('scripts/notify-lark.js')).toBe(false);
  });

  test('no tracked workflow or script publishes to Rabby download infra', () => {
    const scanned = [
      '.github/workflows/build.yml',
      '.github/workflows/flowcheck.yml',
      '.github/workflows/prscan.yml',
      '.github/workflows/update-approvelist.yml',
      '.github/workflows/update-eip7702-supported-chains.yml',
      'scripts/pack-debug.sh',
    ];
    const banned = [
      'download.rabby.io',
      'RabbyDebug',
      'RABBY_BUILD_BUCKET',
      'autobuild.sh',
    ];
    for (const relative of scanned) {
      if (!exists(relative)) continue;
      const source = readSource(relative);
      for (const marker of banned) {
        expect(source).not.toContain(marker);
      }
    }
  });
});
