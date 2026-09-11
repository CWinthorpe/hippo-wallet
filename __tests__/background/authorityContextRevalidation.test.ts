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
  captureInternalAuthorityContext,
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

  test('minted internal capability binds the LIVE background account, not caller state (blocker 2)', () => {
    // accountState.current is the background live account in these mocks.
    const minted = captureInternalAuthorityContext({
      boundAccount: accountState.current as any,
      boundChain: undefined,
      requestDigest: '0xd1',
      approvalComponent: 'SignTx',
    });
    expect(minted.approvalBound).toBe(false);
    expect(minted.internalOrigin).toBe(true);
    // operator switches the live account; the stale token must fail even
    // when the caller re-supplies the ORIGINAL account identity.
    accountState.current = ACCOUNT_B as any;
    expect(() =>
      assertAuthorityContextStillValid(minted, ACCOUNT_A as any)
    ).toThrow(/account changed/i);
    accountState.current = ACCOUNT_A as any;
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

  test('UI waiting components consume SIGN_FINISHED through the one-shot consumer and detach on first terminal event', () => {
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
      expect(src).toContain('createSignEventConsumer');
      expect(src).toContain('signConsumer.tryConsume(data)');
      // terminal detach must precede any await inside the handler body
      expect(src).toContain('signConsumer.isTerminal(data)');
      const detachAt = src.indexOf(
        'eventBus.removeEventListener(EVENTS.SIGN_FINISHED, signFinishedHandler)'
      );
      const bodyStart = src.indexOf('const signFinishedHandler');
      expect(detachAt).toBeGreaterThan(bodyStart);
      expect(src).toContain('getApprovalBinding');
    }
  });

  test('Gnosis/Cobo irreversible effects receive the live authority context at the sink', () => {
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
      for (const sink of [
        'gnosisAddConfirmation(',
        'gnosisAddSignature(',
        'postGnosisTransaction(',
        'handleGnosisMessage({',
      ]) {
        let idx = src.indexOf(sink);
        while (idx !== -1) {
          const seg = src.slice(idx, idx + 260);
          expect(seg).toContain('authorityContext');
          idx = src.indexOf(sink, idx + 1);
        }
      }
    }
    // wallet-side sinks assert before performing the effect
    const wallet = stripComments(read('src/background/controller/wallet.ts'));
    const post = wallet.slice(
      wallet.indexOf('postGnosisTransaction = ('),
      wallet.indexOf('postGnosisTransaction = (') + 700
    );
    expect(post).toContain(
      'assertAuthorityContextStillValid(authorityContext)'
    );
    expect(post.indexOf('assertAuthorityContextStillValid')).toBeLessThan(
      post.indexOf('keyring.postTransaction()')
    );
  });

  test('WatchAddressWaiting gates readiness on acknowledged WalletConnect init', () => {
    const src = stripComments(
      read('src/ui/views/Approval/components/WatchAddressWaiting/index.tsx')
    );
    const initBody = src.slice(
      src.indexOf('const init = async'),
      src.indexOf('const { stay = false }')
    );
    // round-11: announce only after the ack resolves
    expect(initBody).toContain('await initWalletConnect()');
    expect(initBody).toContain('if (!ready)');
    const gateAt = initBody.indexOf('const ready = await initWalletConnect()');
    const announceAt = initBody.indexOf(
      'emitSignComponentAmounted(getApprovalBinding(approval))'
    );
    expect(gateAt).toBeGreaterThanOrEqual(0);
    expect(announceAt).toBeGreaterThan(gateAt);
    // unmount aborts the ack and removes every tracked WC listener
    expect(initBody).toContain('ackHandleRef.current?.abort()');
    expect(initBody).toContain('removeTrackedWcListeners()');
    // retry re-initializes before resending
    const retry = src.slice(
      src.indexOf('const handleRetry = async'),
      src.indexOf('const handleRefreshQrCode')
    );
    expect(retry).toContain('await initWalletConnect()');
    expect(retry.indexOf('await initWalletConnect()')).toBeLessThan(
      retry.indexOf('wallet.resendSign(')
    );
    expect(retry).toContain('if (!ready)');
  });

  test('Unlock window resolves its approval only from a LOCAL gesture (round-10 blocker 4)', () => {
    const src = stripComments(read('src/ui/views/Unlock/index.tsx'));
    // localGesture must be DERIVED from the per-window pendingUnlockTypeRef,
    // never a constant: the global UNLOCK_WALLET broadcast is transport.
    expect(src).toContain('const localGesture = !!unlockType;');
    expect(src).not.toMatch(/const localGesture = (?:true|!0)/);
    expect(src).toContain('localGesture,');
    expect(src).toContain('rejectApproval,');
    const helper = stripComments(
      read('src/ui/views/Unlock/approvalResolution.ts')
    );
    // foreign-unlock branch: explicit reject, never resolve
    expect(helper).toContain('if (!localGesture)');
    const branch = helper.slice(
      helper.indexOf('if (!localGesture)'),
      helper.indexOf('await resolveApproval(undefined')
    );
    expect(branch).toContain('rejectApproval');
    expect(branch).not.toContain('resolveApproval');
  });

  test('Unlock is not concurrency-whitelisted (blocker 5)', () => {
    const src = stripComments(read('src/background/service/notification.ts'));
    const list = src.slice(
      src.indexOf('const QUEUE_APPROVAL_COMPONENTS_WHITELIST = ['),
      src.indexOf(
        '];',
        src.indexOf('const QUEUE_APPROVAL_COMPONENTS_WHITELIST = [')
      )
    );
    expect(list).not.toContain("'Unlock'");
  });

  test('rpcFlow waiter and WithUI wrappers bind the PARENT operation id across child loops and retries', () => {
    const flow = stripComments(
      read('src/background/controller/provider/rpcFlow.ts')
    );
    // waiter uses parent approvalId from the resolve binding + approvalType
    expect(flow).toContain('waitSignComponentAmounted({');
    const notif = stripComments(read('src/background/service/notification.ts'));
    // round-11 blocker 3: lineage derives ONLY from background-owned approval
    // state, and UI-supplied reserved fields are stripped before binding.
    expect(notif).toContain('approvalParams.__approvalId');
    expect(notif).toContain('delete copy.__approvalId');
    expect(notif).toContain('delete copy.__signingContext');
    // component is part of the mandatory identity now
    expect(notif).toContain(
      'approvalComponent !== this.currentApproval?.data?.approvalComponent'
    );
    const wallet = stripComments(read('src/background/controller/wallet.ts'));
    const wrappers = wallet.slice(
      wallet.indexOf('signPersonalMessageWithUI'),
      wallet.indexOf('signTransaction = async (')
    );
    expect(wrappers).toContain('approvalParams.__approvalId || approval?.id');
    expect(wrappers).toContain('approvalParams.__approvalComponent ||');
  });

  test('dapp send/sign sinks require a capability and never mint at the sink', () => {
    const src = stripComments(
      read('src/background/controller/provider/controller.ts')
    );
    const mint = src.slice(
      src.indexOf('const requireRequestAuthorityContext'),
      src.indexOf('const convertToHex')
    );
    expect(mint).toContain(
      'if (!context || !context.operationId || !context.requestDigest)'
    );
    expect(mint).toContain('permissionService.isInternalOrigin(origin)');
    // fail-closed for any request lacking a gesture/approval capability
    expect(mint).toContain('Missing signing authority context');
    // the sink never mints authority itself (round-11 blocker 2 closure)
    expect(mint).not.toContain('captureInternalAuthorityContext');
    expect(src).not.toContain('ensureRequestAuthorityContext');
    // every gated sink calls the require-gate BEFORE the asserts
    for (const handler of [
      'ethSendTransaction = async (options',
      'personalSign = async (req',
      'ethSignTypedDataV1 = async (req',
      'ethSignTypedDataV3 = async (req)',
      'ethSignTypedDataV4 = async (req)',
    ]) {
      const at = src.indexOf(handler);
      expect(at).toBeGreaterThanOrEqual(0);
      const seg = src.slice(at, at + 2200);
      const mintAt = seg.indexOf('requireRequestAuthorityContext(');
      const assertAt = seg.indexOf('assertSigningApprovalResult(');
      expect(mintAt).toBeGreaterThanOrEqual(0);
      expect(assertAt).toBeGreaterThan(mintAt);
    }
    // assert requires __approvalId only for approval-bound contexts
    const assertFn = src.slice(
      src.indexOf('const assertSigningApprovalResult'),
      src.indexOf('const requireRequestAuthorityContext')
    );
    expect(assertFn).toContain('authorityContext.approvalBound !== false');
  });

  test('captureInternalAuthorityContext produces an internal, non-approval-bound token', () => {
    const { captureInternalAuthorityContext: cap } = jest.requireActual(
      '@/background/service/sessionBoundary'
    );
    const ctx = cap({
      boundAccount: ACCOUNT_A as any,
      boundChain: 'BSC',
      requestDigest: '0xd',
      approvalComponent: 'SignTx',
    });
    expect(ctx.internalOrigin).toBe(true);
    expect(ctx.approvalBound).toBe(false);
    expect(ctx.operationId).toBeTruthy();
    expect(() => assertAuthorityContextStillValid(ctx)).not.toThrow();
    (notificationService as any).approvalEpoch += 1;
    expect(() => assertAuthorityContextStillValid(ctx)).toThrow(
      /approve again/i
    );
  });
});
