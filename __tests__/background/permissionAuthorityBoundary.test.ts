/**
 * @jest-environment node
 */
// gpt56 round-8 blocker 2 closure: EVERY authority-bearing mutation in
// permissionService (setSite, updateConnectSite partial and full,
// setRecentConnectedSites bulk load, addConnectedSiteV2, removeConnectedSite)
// must run the session-boundary revoke synchronously BEFORE persistence,
// regardless of caller. These tests drive the real service class with the
// real boundary hook installed the same way sessionBoundary.ts installs it at
// module load, and instrument persistence so ordering is observable.

const trace: string[] = [];

jest.mock('@/background/service/notification', () => ({
  __esModule: true,
  default: {
    rejectAllApprovals: jest.fn(() => trace.push('reject')),
    rejectApprovalsByOrigin: jest.fn((origin: string) =>
      trace.push(`reject-origin:${origin}`)
    ),
    clear: jest.fn(() => trace.push('clear')),
    bumpApprovalEpoch: jest.fn(() => trace.push('epoch')),
    bumpOriginApprovalEpoch: jest.fn((origin: string) =>
      trace.push(`epoch-origin:${origin}`)
    ),
  },
}));

jest.mock('@/background/service/remoteDataPolicy', () => ({
  __esModule: true,
  default: { lock: jest.fn(() => Promise.resolve()) },
}));

const currentAccount: { value: any } = {
  value: { address: '0xAa', type: 'PrivateKey', brandName: 'PrivateKey' },
};

jest.mock('@/background/service/preference', () => ({
  __esModule: true,
  default: {
    getCurrentAccount: jest.fn(() => currentAccount.value),
    setCurrentAccount: jest.fn((a: any) => {
      trace.push('write-account');
      currentAccount.value = a;
    }),
  },
}));

jest.mock('@/utils/chain', () => {
  const known = (e: string) =>
    e === 'ETH' || e === 'BSC' || e === 'OP' ? { serverId: e } : undefined;
  return {
    findChain: ({ enum: e }: any) => known(e),
    findChainByEnum: (e: string) => known(e),
    getChainList: () => [],
    fetchChainList: () => [],
  };
});

// src/constant reads `location` at module scope (browser bundle); provide the
// minimal surface the service under test consumes.
jest.mock('consts', () => ({
  __esModule: true,
  CHAINS_ENUM: { ETH: 'ETH', BSC: 'BSC', OP: 'OP' },
  INTERNAL_REQUEST_ORIGIN: 'self://hippo.origin',
  EVENTS: {
    UPDATE_CACHED_SITE_DATA: 'UPDATE_CACHED_SITE_DATA',
    TRIGGER_CHOOSE_WALLET_CONNECT: 'TRIGGER_CHOOSE_WALLET_CONNECT',
  },
}));
jest.mock('@/constant', () => ({
  __esModule: true,
  CHAINS: [],
  CHAINS_ENUM: { ETH: 'ETH', BSC: 'BSC', OP: 'OP' },
  SIGN_PERMISSION_TYPES: [],
  INTERNAL_REQUEST_ORIGIN: 'self://hippo.origin',
}));

jest.mock('background/utils', () => ({
  createPersistStore: jest.fn(async () => ({ dumpCache: [] })),
}));

import permissionService from '@/background/service/permission';
import type { ConnectedSite } from '@/background/service/permission';
// Importing the boundary installs the hook on permissionService (side effect
// under test — sessionBoundary.ts calls setAuthorityBoundary at module load).
import '@/background/service/sessionBoundary';

const ORIGIN = 'https://dapp.test';
const ACCOUNT_A = {
  address: '0xAa',
  type: 'PrivateKey',
  brandName: 'PrivateKey',
};
const ACCOUNT_B = { address: '0xBb', type: 'HD', brandName: 'Hippo' };

const site = (over: Partial<ConnectedSite>): ConnectedSite => ({
  origin: ORIGIN,
  icon: '',
  name: 'Dapp',
  chain: 'ETH' as any,
  isSigned: false,
  isTop: false,
  isConnected: true,
  account: { ...ACCOUNT_A },
  ...over,
});

describe('permissionService authority boundary (blocker 2)', () => {
  beforeEach(async () => {
    trace.length = 0;
    await permissionService.init();
    const cache = (permissionService as any).lruCache;
    // Instrument persistence so every test can assert the revoke trace entry
    // lands BEFORE the cache write, not just that it lands at all. init()
    // constructs a fresh LRU each time, so a single wrap per test is exact.
    const origSet = cache.set.bind(cache);
    cache.set = (k: string, v: any) => {
      trace.push(`write:${k}`);
      return origSet(k, v);
    };
    const origLoad = cache.load.bind(cache);
    cache.load = (entries: any) => {
      trace.push(
        `load:${(entries || [])
          .map((e: any) => e.k)
          .sort()
          .join(',')}`
      );
      return origLoad(entries);
    };
  });

  test('the boundary hook is installed by sessionBoundary module load', () => {
    expect((permissionService as any).authorityBoundary).toBeInstanceOf(
      Function
    );
  });

  test('setSite with identical authority persists without a revoke', () => {
    permissionService.setSite(site({}));
    trace.length = 0;
    permissionService.setSite(site({}));
    expect(trace).toEqual([`write:${ORIGIN}`]);
  });

  test('setSite account swap revokes the origin synchronously before the cache write', () => {
    permissionService.setSite(site({}));
    trace.length = 0;
    permissionService.setSite(site({ account: { ...ACCOUNT_B } }));
    expect(trace).toEqual([
      `reject-origin:${ORIGIN}`,
      `epoch-origin:${ORIGIN}`,
      `write:${ORIGIN}`,
    ]);
    expect(
      (permissionService.getSite(ORIGIN) as ConnectedSite).account?.address
    ).toBe('0xBb');
  });

  test('updateConnectSite partial chain change revokes even from an out-of-band caller', () => {
    permissionService.setSite(site({}));
    trace.length = 0;
    // Simulates a caller that bypasses WalletController — the exact round-8
    // gap: the service itself must enforce the boundary.
    permissionService.updateConnectSite(ORIGIN, { chain: 'BSC' as any }, true);
    expect(trace).toEqual([
      `reject-origin:${ORIGIN}`,
      `epoch-origin:${ORIGIN}`,
      `write:${ORIGIN}`,
    ]);
  });

  test('updateConnectSite full-snapshot replace revokes on authority drift only', () => {
    permissionService.setSite(site({}));
    trace.length = 0;
    permissionService.updateConnectSite(
      ORIGIN,
      site({ isFavorite: true }),
      false
    );
    expect(trace).toEqual([`write:${ORIGIN}`]); // favorite toggle is not authority

    trace.length = 0;
    permissionService.updateConnectSite(
      ORIGIN,
      site({ isConnected: false }),
      false
    );
    expect(trace).toEqual([
      `reject-origin:${ORIGIN}`,
      `epoch-origin:${ORIGIN}`,
      `write:${ORIGIN}`,
    ]);
  });

  test('two stale full-snapshot writers cannot ABA the account without two epoch bumps', () => {
    permissionService.setSite(site({}));
    trace.length = 0;
    // Writer 1 moves A→B, writer 2 (stale snapshot) moves B→A.
    permissionService.setSite(site({ account: { ...ACCOUNT_B } }));
    permissionService.setSite(site({}));
    const bumps = trace.filter((t) => t === `epoch-origin:${ORIGIN}`);
    expect(bumps.length).toBe(2);
    // Final persisted state equals the original while the origin epoch
    // advanced twice: exactly what defeats rpcFlow's old identity-only ABA.
  });

  test('setRecentConnectedSites bulk load revokes changed origins before persisting any of them', () => {
    permissionService.setSite(site({ origin: 'https://keep.test' }));
    permissionService.setSite(site({ origin: 'https://move.test' }));
    trace.length = 0;
    permissionService.setRecentConnectedSites([
      site({ origin: 'https://keep.test' }),
      site({ origin: 'https://move.test', account: { ...ACCOUNT_B } }),
    ]);
    expect(trace).toEqual([
      'reject-origin:https://move.test',
      'epoch-origin:https://move.test',
      'load:https://keep.test,https://move.test',
      // lru-cache v6 load() writes each entry through set(); the boundary
      // revocations above still precede every persistence write.
      'write:https://move.test',
      'write:https://keep.test',
    ]);
    expect(trace.indexOf('reject-origin:https://move.test')).toBeLessThan(
      trace.indexOf('load:https://keep.test,https://move.test')
    );
  });

  test('addConnectedSiteV2 reconnect of a disconnected site crosses the boundary', () => {
    permissionService.setSite(site({ isConnected: false }));
    trace.length = 0;
    permissionService.addConnectedSiteV2({
      origin: ORIGIN,
      name: 'Dapp',
      icon: '',
      defaultChain: 'ETH' as any,
      defaultAccount: { ...ACCOUNT_A } as any,
    });
    expect(trace[0]).toBe(`reject-origin:${ORIGIN}`);
    expect(trace[1]).toBe(`epoch-origin:${ORIGIN}`);
    expect(trace).toContain(`write:${ORIGIN}`);
  });

  test('service-level removeConnectedSite disconnect revokes before persist', () => {
    permissionService.setSite(site({}));
    trace.length = 0;
    permissionService.removeConnectedSite(ORIGIN);
    expect(trace[0]).toBe(`reject-origin:${ORIGIN}`);
    expect(trace[1]).toBe(`epoch-origin:${ORIGIN}`);
    expect(trace).toContain(`write:${ORIGIN}`);
  });
});
