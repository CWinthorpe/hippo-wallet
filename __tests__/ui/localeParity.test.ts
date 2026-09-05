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

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

const REFERENCED_KEYS: string[] = (() => {
  const out = new Set<string>();
  const files = execSync(
    "git grep -l -E \"t\\('\" -- src",
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
  return [...out];
})();

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

  test('the v0.94.7 sync introduces no new removed-product namespaces in any locale', () => {
    // Relative regression guard against the pre-sync Hippo baseline: inert
    // legacy copy namespaces already present at the baseline are allowed, but
    // the upstream merge must not resurrect wholesale namespaces for views
    // Hippo deleted (perps, swap/bridge, gas-account stores, points, staking).
    const BASELINE = '0554f1cf1d0a8f5008b26c6ad1d2d5c1758a4641';
    for (const loc of LOCALES) {
      const p = `_raw/locales/${loc}/messages.json`;
      const base = JSON.parse(
        execSync(`git show ${BASELINE}:${p}`, {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        })
      );
      const now = readJson(p);
      const baseKeys = new Set(Object.keys(base.page ?? {}));
      const newKeys = Object.keys(now.page ?? {}).filter(
        (k) => !baseKeys.has(k)
      );
      // Namespaces upstream removed entirely must never appear.
      expect(newKeys.filter((k) => ['perps', 'staking', 'lending'].includes(k))).toEqual([]);
      // Any other newly introduced namespace must be referenced by retained
      // code (adopted for live keys), not wholesale inert copy.
      const referenced = new Set(REFERENCED_KEYS);
      for (const ns of newKeys) {
        const flat: string[] = [];
        const walk = (obj: any, pre: string) => {
          for (const [k, v] of Object.entries(obj)) {
            const p = `${pre}.${k}`;
            if (v && typeof v === 'object') walk(v, p);
            else flat.push(p);
          }
        };
        walk((now.page as any)[ns], `page.${ns}`);
        const used = flat.filter((k) => referenced.has(k));
        expect(used.length > 0 || flat.length === 0).toBe(true);
      }
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
  });
});
