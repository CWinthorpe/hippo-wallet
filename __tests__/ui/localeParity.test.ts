import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const LOCALES = [
  'de',
  'en',
  'es',
  'fr-FR',
  'id',
  'ja',
  'ko',
  'pt-BR',
  'pt',
  'ru',
  'tr',
  'uk-UA',
  'vi',
  'zh-CN',
  'zh-HK',
];

const BASELINE = '0554f1cf1d0a8f5008b26c6ad1d2d5c1758a4641';

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

const flatten = (obj: unknown, prefix = ''): string[] => {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') out.push(...flatten(v, p));
    else out.push(p);
  }
  return out;
};

/** Every dotted leaf key referenced anywhere in src as `t('...')`. */
const REFERENCED_KEYS: Set<string> = (() => {
  const out = new Set<string>();
  const files = execSync(
    "git grep -l -E \"t\\\\('\" -- src",
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  )
    .trim()
    .split('\n')
    .filter(Boolean);
  const pattern = /\bt\(\s*'([a-zA-Z0-9_.]+)'/g;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(src))) out.add(m[1]);
    pattern.lastIndex = 0;
  }
  return out;
})();

/**
 * Namespaces whose copy would restore a product Hippo removed. Any NEW
 * locale leaf landing under one of these segments (at any depth) is a
 * regression guard failure, regardless of whether its namespace is new.
 */
const REMOVED_PRODUCT_SEGMENTS = [
  'gasAccount',
  'gasless',
  'buyNFT',
  'sellNFT',
  'perps',
  'staking',
  'lending',
  'faucet',
  'points',
  'quests',
  'promotion',
  'vip',
];

/**
 * New leaves that are allowed despite a removed-product-looking name: these
 * are neutral data labels referenced by retained components (token
 * provenance in the token detail popup, ManageApprovals count, WalletConnect
 * relay-server setting, chain-selector placeholder, token liquidity tier).
 */
const NEUTRAL_ALLOWLIST = new Set([
  'component.TokenSelector.liquidity.high',
  'component.TokenSelector.liquidity.low',
  'page.dashboard.tokenDetail.BridgeIssue',
  'page.dashboard.tokenDetail.BridgeProvider',
  'page.manageApprovals.approvalsCount',
  'page.newAddress.walletConnect.changeBridgeServer',
  'page.sendToken.chainPlaceholder',
]);

/** Values that would package removed-product copy (brand/product strings). */
const REMOVED_PRODUCT_VALUES = [
  'gasaccount',
  'free gas',
  'rabby points',
  'perpetual',
  'staking',
  'liquidity mining',
];

const hasPath = (obj: unknown, dotted: string) => {
  let cur: any = obj;
  for (const part of dotted.split('.')) {
    if (!cur || typeof cur !== 'object' || !(part in cur)) return false;
    cur = cur[part];
  }
  return true;
};

describe('locale parity after v0.94.7 sync', () => {
  test('retained source keys introduced by upstream exist in every locale', () => {
    // keys referenced by retained (non-removed-product) code that the
    // v0.94.7 sync must have carried into packaged locales
    for (const loc of LOCALES) {
      const tree = readJson(`_raw/locales/${loc}/messages.json`);
      expect(hasPath(tree, 'page.dashboard.assets.unfoldChain')).toBe(true);
      expect(hasPath(tree, 'page.dashboard.assets.unfoldChainPlural')).toBe(
        true
      );
    }
  });

  test('no baseline locale leaf was deleted in any packaged locale', () => {
    // A sync must never silently drop copy that the previous release had,
    // and the guard must catch deletions of nested leaves, not only whole
    // namespaces.
    for (const loc of LOCALES) {
      const p = `_raw/locales/${loc}/messages.json`;
      const base = JSON.parse(
        execSync(`git show ${BASELINE}:${p}`, {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        })
      );
      const now = readJson(p);
      const baseLeaves = new Set(flatten(base));
      const nowLeaves = new Set(flatten(now));
      const removed = [...baseLeaves].filter((k) => !nowLeaves.has(k));
      expect(removed).toEqual([]);
    }
  });

  test('no new leaf resurrects removed-product copy in any locale', () => {
    // Relative regression guard against the pre-sync Hippo baseline: inert
    // legacy copy namespaces already present at the baseline are allowed, but
    // NOTHING new -- neither a whole namespace nor a single leaf under an
    // existing namespace -- may package copy for a removed product.
    for (const loc of LOCALES) {
      const p = `_raw/locales/${loc}/messages.json`;
      const base = JSON.parse(
        execSync(`git show ${BASELINE}:${p}`, {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        })
      );
      const now = readJson(p);
      const baseLeaves = new Set(flatten(base));
      const nowLeaves = flatten(now);
      const newLeaves = nowLeaves.filter((k) => !baseLeaves.has(k));

      for (const leaf of newLeaves) {
        const segments = leaf.split('.');
        const hitsRemovedSegment = segments.some((seg) =>
          REMOVED_PRODUCT_SEGMENTS.includes(seg.toLowerCase())
        );
        if (hitsRemovedSegment && !NEUTRAL_ALLOWLIST.has(leaf)) {
          throw new Error(
            `${loc}: new locale leaf '${leaf}' lands under a removed-product segment`
          );
        }
        const value = (() => {
          let cur: any = now;
          for (const part of leaf.split('.')) cur = cur?.[part];
          return typeof cur === 'string' ? cur.toLowerCase() : '';
        })();
        if (!NEUTRAL_ALLOWLIST.has(leaf)) {
          for (const forbidden of REMOVED_PRODUCT_VALUES) {
            expect(value.includes(forbidden)).toBe(false);
          }
        }
      }
    }
  });

  test('every new locale leaf is referenced by retained source (or allowlisted)' , () => {
    // Anything introduced by the sync must be wiring for retained code --
    // unreferenced added copy is dead packaging.
    const p = '_raw/locales/en/messages.json';
    const base = JSON.parse(
      execSync(`git show ${BASELINE}:${p}`, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      })
    );
    const now = readJson(p);
    const baseLeaves = new Set(flatten(base));
    const newLeaves = flatten(now).filter((k) => !baseLeaves.has(k));
    for (const leaf of newLeaves) {
      expect(
        REFERENCED_KEYS.has(leaf) || NEUTRAL_ALLOWLIST.has(leaf)
      ).toBe(true);
    }
  });

  test('removed swap-bridge preview components are not in the build graph', () => {
    const hits = execSync(
      "git grep -l 'SignMainnetSwapGasQuotePopup' -- src || true",
      { encoding: 'utf8' }
    ).trim();
    expect(hits).toBe('');
    expect(fs.existsSync('src/ui/models')).toBe(false);
    expect(
      fs.existsSync(
        path.join(
          process.cwd(),
          'src/ui/views/Approval/components/TxComponents/GasSelector/SignMainnetSwapGasQuotePopup.tsx'
        )
      )
    ).toBe(false);
    // The packaged English locale must not carry bridge/gas-account/swap
    // status product copy (present in the v0.94.7 upstream tree).
    const locale = fs.readFileSync('_raw/locales/en/messages.json', 'utf8');
    for (const forbidden of [
      '"gasAccount"',
      '"buyNFT"',
      '"sellNFT"',
      '"page": {"bridge"',
    ]) {
      expect(locale.includes(forbidden)).toBe(false);
    }
  });
});
