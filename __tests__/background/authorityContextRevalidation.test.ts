/**
 * @jest-environment node
 */
// Regressors for gpt56 round-8 blockers 1 and 3:
//
// (3) Epoch checks previously stopped at provider-handler entry; async
// keyring/hardware/RPC work inside a handler could outlive a lock, account
// switch, chain switch, or disconnect and still sign or broadcast. These
// tests pin the authority-context primitive itself (behavioral: every drift
// direction throws user-rejected) and the sink-adjacent wiring in
// controller.ts / wallet.ts via source contracts, including a stalled-sign
// interleaving trace against the real primitive.
//
// (1) Cobo delegation must never move the global current account: the
// parent approval's own boundary must survive the handoff, and no singleton
// restore slot may exist.

import 'reflect-metadata';
import fs from 'fs';
import path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');

let trace: string[] = [];

jest.mock('@/background/service/notification', () => ({
  __esModule: true,
  default: {
    approvalEpoch: 0,
    getOriginApprovalEpoch: (origin: string) =>
      (global as any).__originEpochs?.get(origin) ?? 0,
    rejectAllApprovals: jest.fn(() => trace.push('reject')),
    clear: jest.fn(() => trace.push('clear')),
    bumpApprovalEpoch: jest.fn(() => trace.push('epoch')),
    rejectApprovalsByOrigin: jest.fn((origin: string) =>
      trace.push(`reject-origin:${origin}`)
    ),
    bumpOriginApprovalEpoch: jest.fn((origin: string) => {
      if (!(global as any).__originEpochs) {
        (global as any).__originEpochs = new Map<string, number>();
      }
      (global as any).__originEpochs.set(
        origin,
        ((global as any).__originEpochs.get(origin) ?? 0) + 1
      );
      trace.push(`epoch-origin:${origin}`);
    }),
  },
}));

jest.mock('@/background/service/remoteDataPolicy', () => ({
  __esModule: true,
  default: { lock: jest.fn(() => Promise.resolve()) },
}));

const accountState = {
  current: null as null | {
    address: string;
    type?: string;
    brandName?: string;
  },
  isEnabledDappAccount: false,
};

jest.mock('@/background/service/preference', () => ({
  __esModule: true,
  default: {
    getCurrentAccount: jest.fn(() => accountState.current),
    setCurrentAccount: jest.fn((account: any) => {
      trace.push('write-account');
      accountState.current = account;
    }),
    getPreference: jest.fn((key: string) =>
      key === 'isEnabledDappAccount'
        ? accountState.isEnabledDappAccount
        : undefined
    ),
  },
}));

const siteState = {
  hasPermission: true,
  site: null as null | {
    origin: string;
    chain?: string;
    account?: any;
    isConnected?: boolean;
  },
  internalOrigin: false,
};

jest.mock('@/background/service/permission', () => ({
  __esModule: true,
  default: {
    getSites: jest.fn(() => []),
    setAuthorityBoundary: jest.fn(),
    hasPermission: jest.fn(() => siteState.hasPermission),
    getConnectedSite: jest.fn(() => siteState.site),
    isInternalOrigin: jest.fn(() => siteState.internalOrigin),
  },
}));

import notificationService from '@/background/service/notification';
import {
  assertAuthorityContextStillValid,
  captureAuthorityContext,
  AuthorityContext,
} from '@/background/service/sessionBoundary';

const DAPP_ORIGIN = 'https://dapp.test';
const ACCOUNT_A = { address: '0xAa', type: 'HD', brandName: 'Hippo' };
const ACCOUNT_B = {
  address: '0xBb',
  type: 'PrivateKey',
  brandName: 'PrivateKey',
};

const makeContext = (
  overrides: Partial<AuthorityContext> = {}
): AuthorityContext =>
  captureAuthorityContext({
    origin: DAPP_ORIGIN,
    boundAccount: ACCOUNT_A as any,
    boundChain: 'ETH',
    internalOrigin: false,
    operationId: 'op-1',
    requestDigest: '0xdigest',
    approvalComponent: 'SignTx',
    ...({} as any),
  } as any);

const settle = (p: () => void) => p();

describe('authority-context primitive (blocker 3)', () => {
  beforeEach(() => {
    trace = [];
    accountState.current = ACCOUNT_A as any;
    accountState.isEnabledDappAccount = false;
    siteState.hasPermission = true;
    siteState.site = {
      origin: DAPP_ORIGIN,
      chain: 'ETH',
      account: ACCOUNT_A as any,
      isConnected: true,
    };
    siteState.internalOrigin = false;
    (global as any).__originEpochs = new Map();
  });

  test('capture snapshots global and origin epochs at creation', () => {
    (notificationService as any).approvalEpoch = 7;
    (global as any).__originEpochs.set(DAPP_ORIGIN, 3);
    const ctx = makeContext();
    expect(ctx.approvalEpoch).toBe(7);
    expect(ctx.originEpoch).toBe(3);
    expect(ctx.boundAccount?.address).toBe('0xaa');
    (notificationService as any).approvalEpoch = 0;
  });

  test('matching live state passes the recheck', () => {
    const ctx = makeContext();
    expect(() => assertAuthorityContextStillValid(ctx)).not.toThrow();
  });

  test('a global epoch bump (lock / account switch / reset) fails the recheck', () => {
    const ctx = makeContext();
    (notificationService as any).approvalEpoch += 1;
    expect(() => assertAuthorityContextStillValid(ctx)).toThrow(
      /approve again/i
    );
  });

  test('an origin epoch bump (disconnect / site authority change) fails the recheck', () => {
    const ctx = makeContext();
    notificationService.bumpOriginApprovalEpoch(DAPP_ORIGIN);
    expect(() => assertAuthorityContextStillValid(ctx)).toThrow(
      /approve again/i
    );
  });

  test('permission loss fails the recheck', () => {
    const ctx = makeContext();
    siteState.hasPermission = false;
    expect(() => assertAuthorityContextStillValid(ctx)).toThrow(/revoked/i);
  });

  test('current-account drift fails the recheck (account switched under a stalled sign)', () => {
    const ctx = makeContext();
    accountState.current = ACCOUNT_B as any;
    expect(() => assertAuthorityContextStillValid(ctx)).toThrow(
      /account changed/i
    );
  });

  test('dapp-account drift fails the recheck when site-scoped account is active', () => {
    accountState.isEnabledDappAccount = true;
    const ctx = makeContext();
    siteState.site = { ...siteState.site!, account: ACCOUNT_B as any };
    expect(() => assertAuthorityContextStillValid(ctx)).toThrow(
      /account changed/i
    );
    accountState.isEnabledDappAccount = false;
  });

  test('chain drift fails the recheck', () => {
    const ctx = makeContext();
    siteState.site = { ...siteState.site!, chain: 'BSC' };
    expect(() => assertAuthorityContextStillValid(ctx)).toThrow(
      /chain changed/i
    );
  });

  test('missing operation identity fails closed', () => {
    const ctx = makeContext();
    expect(() =>
      assertAuthorityContextStillValid({ ...ctx, operationId: '' })
    ).toThrow(/approve again/i);
    expect(() => assertAuthorityContextStillValid(undefined as any)).toThrow(
      /approve again/i
    );
  });

  test('locked wallet (no current account) fails closed', () => {
    const ctx = makeContext();
    accountState.current = null;
    expect(() => assertAuthorityContextStillValid(ctx)).toThrow(
      /approve again/i
    );
  });

  test('stalled-sign interleaving: revocation landing mid-operation reddens the deferred sink continuation', async () => {
    // Model the exact round-8 shape: handler captured a valid context, then
    // awaits a slow hardware signature; meanwhile the user locks; the
    // continuation resumes and must abort at the sink-adjacent recheck with
    // zero broadcast and zero result release.
    const ctx = makeContext();
    let sinkRan = false;
    const resultReleased = false;

    const signOperation = async () => {
      // (1) pre-sign check passes at capture time
      assertAuthorityContextStillValid(ctx);
      // (2) stalled signature await
      await new Promise<void>((resolve) => {
        settle(() => {
          // (3) boundary crosses WHILE stalled: lock bumps global epoch
          (notificationService as any).approvalEpoch += 1;
          resolve();
        });
      });
      // (4) sink-adjacent recheck must throw before broadcast/return
      assertAuthorityContextStillValid(ctx);
      sinkRan = true;
      return 'signature';
    };

    await expect(signOperation()).rejects.toThrow(/approve again/i);
    expect(sinkRan).toBe(false);
    expect(resultReleased).toBe(false);
  });

  test('internal origin skips site authority but not global epochs', () => {
    const ctx = captureAuthorityContext({
      origin: 'self://hippo.origin',
      boundAccount: ACCOUNT_A as any,
      boundChain: undefined,
      internalOrigin: true,
      operationId: 'op-2',
      requestDigest: '0xdigest2',
      approvalComponent: 'SignTx',
    });
    siteState.hasPermission = false;
    expect(() => assertAuthorityContextStillValid(ctx)).not.toThrow();
    (notificationService as any).approvalEpoch += 1;
    expect(() => assertAuthorityContextStillValid(ctx)).toThrow(
      /approve again/i
    );
  });
});

describe('sink wiring source contracts (blocker 3)', () => {
  test('controller sign/broadcast path revalidates authority immediately before signing and submission', () => {
    const src = stripComments(
      read('src/background/controller/provider/controller.ts')
    );
    expect(src).toContain('assertAuthorityContextStillValid');
    // pre-sign gate exists inside the try block before the keyring sign call
    const tryAt = src.indexOf('let signedTx;');
    const signCall = src.indexOf('keyringService.signTransaction', tryAt);
    const preSign = src.lastIndexOf(
      'assertAuthorityContextStillValid',
      signCall
    );
    expect(tryAt).toBeGreaterThanOrEqual(0);
    expect(signCall).toBeGreaterThanOrEqual(0);
    expect(preSign).toBeGreaterThan(tryAt);
    // submission gate exists between gas validation and hash submission
    const validateAt = src.indexOf('validateGasPriceRange(approvalRes)');
    const submitGuardAt = src.indexOf(
      'assertAuthorityContextStillValid',
      validateAt
    );
    expect(validateAt).toBeGreaterThanOrEqual(0);
    expect(submitGuardAt).toBeGreaterThan(validateAt);
    expect(submitGuardAt).toBeLessThan(
      src.indexOf('onTransactionCreated', validateAt)
    );
  });

  test('background signPersonalMessage/signTypedData on WalletController require binding + unlocked state', () => {
    const src = stripComments(read('src/background/controller/wallet.ts'));
    for (const [name, nextMarker] of [
      ['signPersonalMessage', 'signTypedData = async ('],
      ['signTypedData', 'signTransaction = async ('],
    ] as const) {
      const body = src.slice(
        src.indexOf(`${name} = async (`),
        src.indexOf(nextMarker)
      );
      expect(body).toContain('Missing signing authority binding');
      expect(body).toContain('Missing signing approval; approve again.');
      expect(body).toContain(
        'assertAuthorityContextStillValid(authorityContext)'
      );
      expect(body).toContain('isUnlocked');
      expect(body).toContain('SIGN_FINISHED');
      // completion event must carry the exact binding
      expect(body).toContain('authorityContext: binding.authorityContext');
      // the waiter itself must be bound to the exact approval
      expect(body).toContain('waitSignComponentAmounted(binding)');
    }
  });
});

describe('Cobo delegation is request-scoped (blocker 1)', () => {
  test('coboSafeBuildTransaction performs no global account switch or restore slot', () => {
    const src = stripComments(read('src/background/controller/wallet.ts'));
    const body = src.slice(
      src.indexOf('coboSafeBuildTransaction = async ('),
      src.indexOf('coboSafeImport = async (')
    );
    expect(body).not.toContain('setCurrentAccountWithBoundary');
    expect(body).not.toContain('saveCurrentCoboSafeAddress');
    expect(body).not.toContain('preferenceService.setCurrentAccount');
    expect(src).not.toContain('coboSafeResetCurrentAccount');
    expect(src).not.toContain('resetCurrentCoboSafeAccountWithBoundary');
  });

  test('preference and sessionBoundary carry no Cobo singleton restore state', () => {
    const preference = stripComments(
      read('src/background/service/preference.ts')
    );
    expect(preference).not.toContain('currentCoboSafeAddress');
    expect(preference).not.toContain('saveCurrentCoboSafeAddress');
    expect(preference).not.toContain('resetCurrentCoboSafeAddress');
    const boundary = stripComments(
      read('src/background/service/sessionBoundary.ts')
    );
    expect(boundary).not.toContain('resetCurrentCoboSafeAccountWithBoundary');
  });

  test('SignTx hands the delegated account to the child request instead of switching globally', () => {
    const src = stripComments(
      read('src/ui/views/Approval/components/SignTx.tsx')
    );
    const body = src.slice(
      src.indexOf('handleCoboArugsConfirm'),
      src.indexOf('const { activeApprovalPopup }')
    );
    expect(body).toContain('isCoboSafe: true');
    expect(body).toMatch(/sendRequest\([\s\S]*\{ account \}/);
    expect(body).not.toContain('coboSafeResetCurrentAccount');
  });

  test('the parent approval boundary primitive list stays centralized (no direct identity writes in provider controller)', () => {
    const src = stripComments(
      read('src/background/controller/provider/controller.ts')
    );
    expect(src).not.toContain('preferenceService.setCurrentAccount(');
    expect(src).not.toContain('resetCurrentCoboSafeAccountWithBoundary');
    // isCoboSafe must never gate privileged behavior; it is stripped from
    // dApp/child-supplied txParams fail-closed.
    expect(src).toContain('delete txParams.isCoboSafe');
    const coboGates = src.match(/if\s*\(\s*isCoboSafe/g) || [];
    expect(coboGates.length).toBe(0);
  });
});

describe('approval-bound vs internal signing separation (blocker 4)', () => {
  const read = (p: string) =>
    fs.readFileSync(path.join(process.cwd(), p), 'utf8');

  test('internal (non-dApp) typed-data path is separated from the approval-bound handshake', () => {
    const src = stripComments(read('src/background/controller/wallet.ts'));
    const bare = src.slice(
      src.indexOf('signTypedData = async ('),
      src.indexOf('signTypedDataWithUI')
    );
    expect(bare).toContain('Missing signing authority binding');
    const internal = src.slice(
      src.indexOf('signTypedDataInternal = async ('),
      src.indexOf('decryptMessage = async (')
    );
    expect(internal).toContain('isUnlocked');
    expect(internal).toContain('signTypedMessage');
    // blocker 4: the internal path must NOT broadcast an approval-bound
    // completion event into the global UI bus.
    expect(internal).not.toContain('SIGN_FINISHED');
    expect(internal).not.toContain('broadcastToUI');
    const miniSign = stripComments(read('src/ui/utils/sendTypedData.ts'));
    expect(miniSign).toContain('signTypedDataInternal');
    expect(miniSign).not.toMatch(/wallet\.signTypedData\(/);
    const signTx = stripComments(
      read('src/ui/views/Approval/components/SignTx.tsx')
    );
    // every direct (awaited-result) consumer uses the internal path; the
    // dApp fire-and-forget path keeps WithUI
    expect(signTx).toContain('wallet.signTypedDataInternal(');
    expect(signTx).not.toMatch(/wallet\.signTypedData\(/);
  });

  test('UI waiting components consume SIGN_FINISHED only through the binding matcher and detach listeners', () => {
    const components = [
      'src/ui/views/Approval/components/CommonWaiting.tsx',
      'src/ui/views/Approval/components/LedgerHardwareWaiting.tsx',
      'src/ui/views/Approval/components/ImKeyHardwareWaiting.tsx',
      'src/ui/views/Approval/components/PrivatekeyWaiting.tsx',
      'src/ui/views/Approval/components/CoinbaseWaiting/index.tsx',
      'src/ui/views/Approval/components/WatchAddressWaiting/index.tsx',
      'src/ui/views/Approval/components/QRHardWareWaiting/QRHardWareWaiting.tsx',
    ];
    for (const file of components) {
      const src = stripComments(read(file));
      expect(src).toContain('matchesSignEvent');
      expect(src).toContain('getApprovalBinding');
      expect(src).toContain('removeEventListener');
    }
  });
});
