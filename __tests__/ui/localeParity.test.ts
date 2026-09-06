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

const readBaseline = (p: string) =>
  JSON.parse(
    execSync(`git show ${BASELINE}:${p}`, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
  );

const localePath = (loc: string) => `_raw/locales/${loc}/messages.json`;

/**
 * Payload loader used by every per-locale check below. Tests may override it
 * (see the in-test mutant probes) to inject synthetic trees WITHOUT touching
 * packaged files, so the probes exercise the exact production collection
 * path — including which locales it iterates.
 */
let localePayloads:
  | ((loc: string) => { baseline: unknown; now: unknown })
  | undefined;

const loadLocalePair = (loc: string) =>
  localePayloads
    ? localePayloads(loc)
    : {
        baseline: readBaseline(localePath(loc)),
        now: readJson(localePath(loc)),
      };

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
  const files = execSync('git grep -l -E "t\\\\(\'" -- src', {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
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
 * Stored LOWERCASED and compared against lowercased segments: round-3's
 * surviving mutant proved a one-sided lower() (candidate normalized, token
 * list mixed-case) lets `gasAccount` slip through.
 */
const REMOVED_PRODUCT_SEGMENTS = [
  'gasaccount',
  'gasless',
  'buynft',
  'sellnft',
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

/** Added leaves in `now` relative to `baseline`. */
const addedLeaves = (baseline: unknown, now: unknown): string[] => {
  const baseLeaves = new Set(flatten(baseline));
  return flatten(now).filter((k) => !baseLeaves.has(k));
};

/**
 * Per-locale added-leaf analysis. Returns every violation for ONE locale:
 *  - a new leaf under a removed-product segment (normalized both operands),
 *  - a new leaf packaging a removed-product value,
 *  - a new leaf not referenced by retained source and not allowlisted.
 */
const localeAddedLeafViolations = (
  loc: string,
  baseline: unknown,
  now: unknown
): string[] => {
  const violations: string[] = [];
  for (const leaf of addedLeaves(baseline, now)) {
    const segments = leaf.split('.');
    const hitsRemovedSegment = segments.some((seg) =>
      REMOVED_PRODUCT_SEGMENTS.includes(seg.toLowerCase())
    );
    if (hitsRemovedSegment && !NEUTRAL_ALLOWLIST.has(leaf)) {
      violations.push(
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
        if (value.includes(forbidden)) {
          violations.push(
            `${loc}: new locale leaf '${leaf}' packages removed-product value '${forbidden}'`
          );
        }
      }
      if (!REFERENCED_KEYS.has(leaf)) {
        violations.push(
          `${loc}: new locale leaf '${leaf}' is not referenced by retained source and not allowlisted`
        );
      }
    }
  }
  return violations;
};

/**
 * The production collector: EVERY packaged locale is analyzed — round-3
 * showed an English-only computation leaves a German-only injected leaf
 * completely unchecked. The in-test probes below override the payload loader
 * and run through this same function, so narrowing it back to English (or
 * weakening the comparisons) turns those probes RED.
 */
const collectAddedLeafViolations = (): string[] => {
  const violations: string[] = [];
  for (const loc of LOCALES) {
    const { baseline, now } = loadLocalePair(loc);
    violations.push(...localeAddedLeafViolations(loc, baseline, now));
  }
  return violations;
};

const setLeaf = (tree: Record<string, any>, dotted: string, value: unknown) => {
  const next = JSON.parse(JSON.stringify(tree));
  let cur = next;
  const parts = dotted.split('.');
  for (const part of parts.slice(0, -1)) {
    if (!cur[part] || typeof cur[part] !== 'object') cur[part] = {};
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
  return next;
};

describe('locale parity after v0.94.7 sync', () => {
  afterEach(() => {
    localePayloads = undefined;
  });

  test('retained source keys introduced by upstream exist in every locale', () => {
    // keys referenced by retained (non-removed-product) code that the
    // v0.94.7 sync must have carried into packaged locales
    for (const loc of LOCALES) {
      const tree = readJson(localePath(loc));
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
      const { baseline, now } = loadLocalePair(loc);
      const baseLeaves = new Set(flatten(baseline));
      const nowLeaves = new Set(flatten(now));
      const removed = [...baseLeaves].filter((k) => !nowLeaves.has(k));
      expect(removed).toEqual([]);
    }
  });

  test('no new leaf resurrects removed-product copy or dead packaging in any locale', () => {
    // Relative regression guard against the pre-sync Hippo baseline: inert
    // legacy copy namespaces already present at the baseline are allowed, but
    // NOTHING new -- neither a whole namespace nor a single leaf under an
    // existing namespace -- may package copy for a removed product or sit
    // unreferenced by retained source. Every packaged locale is checked.
    expect(collectAddedLeafViolations()).toEqual([]);
  });

  test('in-test mutant probes: guards go RED on the exact round-3 surviving mutants', () => {
    // Probe 1 (EN, retained from round 2): deleting a referenced baseline
    // leaf is detected by the deletion guard.
    const enPair = loadLocalePair('en');
    const mutatedDelete = JSON.parse(JSON.stringify(enPair.now));
    delete mutatedDelete.background.alias.HdKeyring;
    const baseLeaves = new Set(flatten(enPair.baseline));
    const nowLeaves = new Set(flatten(mutatedDelete));
    const detectedDeletion = [...baseLeaves].filter((k) => !nowLeaves.has(k));
    expect(detectedDeletion).toContain('background.alias.HdKeyring');

    // Probe 2 (EN): an unused English leaf under an accepted namespace must
    // be flagged through the production collector.
    localePayloads = (loc) =>
      loc === 'en'
        ? {
            baseline: enPair.baseline,
            now: setLeaf(
              enPair.now,
              'page.manageApprovals.__en_unused_probe',
              'Probe'
            ),
          }
        : {
            baseline: readBaseline(localePath(loc)),
            now: readJson(localePath(loc)),
          };
    expect(
      collectAddedLeafViolations().some((v) =>
        v.includes('page.manageApprovals.__en_unused_probe')
      )
    ).toBe(true);

    // Probe 3 (DE, round-3 surviving mutant #1): an unused German leaf under
    // the accepted component.TokenSelector.liquidity namespace must be
    // flagged. The pre-fix collector computed added leaves for English only,
    // so this injection passed silently — a regression to English-only
    // collection turns this expectation RED.
    const dePath = localePath('de');
    const deBase = readBaseline(dePath);
    const deNow = readJson(dePath);
    localePayloads = (loc) =>
      loc === 'de'
        ? {
            baseline: deBase,
            now: setLeaf(
              deNow,
              'component.TokenSelector.liquidity.__de_unused_probe',
              'Sonde'
            ),
          }
        : {
            baseline: readBaseline(localePath(loc)),
            now: readJson(localePath(loc)),
          };
    expect(
      collectAddedLeafViolations().some((v) =>
        v.includes('component.TokenSelector.liquidity.__de_unused_probe')
      )
    ).toBe(true);

    // Probe 4 (DE, round-3 surviving mutant #2): a German leaf under the
    // mixed-case removed-product namespace `gasAccount` must be flagged.
    // The pre-fix code lowercased the candidate path but compared against a
    // mixed-case token list, so `gasAccount` never matched — a regression to
    // one-sided normalization turns this expectation RED.
    localePayloads = (loc) =>
      loc === 'de'
        ? {
            baseline: deBase,
            now: setLeaf(deNow, 'page.gasAccount.__wholesale_probe', 'Sonde'),
          }
        : {
            baseline: readBaseline(localePath(loc)),
            now: readJson(localePath(loc)),
          };
    expect(
      collectAddedLeafViolations().some((v) =>
        v.includes('page.gasAccount.__wholesale_probe')
      )
    ).toBe(true);

    // Probe 5 (DE): the same mixed-case namespace must also be caught when
    // injected deeper (defense-in-depth at any depth, in a non-English
    // locale).
    localePayloads = (loc) =>
      loc === 'de'
        ? {
            baseline: deBase,
            now: setLeaf(
              deNow,
              'page.gasAccount.nested.deeper.__probe',
              'Sonde'
            ),
          }
        : {
            baseline: readBaseline(localePath(loc)),
            now: readJson(localePath(loc)),
          };
    expect(
      collectAddedLeafViolations().some((v) =>
        v.includes('page.gasAccount.nested.deeper.__probe')
      )
    ).toBe(true);
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
