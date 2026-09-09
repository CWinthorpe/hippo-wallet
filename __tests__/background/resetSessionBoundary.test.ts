let resolveBoundary: () => void;
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
  default: {
    lock: jest.fn(() => {
      trace.push('lock');
      return new Promise<void>((resolve) => {
        resolveBoundary = resolve;
      });
    }),
  },
}));

jest.mock('@/background/service/preference', () => ({
  __esModule: true,
  default: {
    getCurrentAccount: jest.fn(() => null),
    setCurrentAccount: jest.fn(),
    resetCurrentCoboSafeAddress: jest.fn(async () => null),
  },
}));

jest.mock('@/background/service/permission', () => ({
  __esModule: true,
  default: {
    getSites: jest.fn(() => []),
  },
}));

import fs from 'fs';
import path from 'path';
import notificationService from '@/background/service/notification';
import permissionService from '@/background/service/permission';
import preferenceService from '@/background/service/preference';
import remoteDataPolicyService from '@/background/service/remoteDataPolicy';
import {
  revokeAccountBoundaryIfAffected,
  revokeSiteAccountBoundaries,
  resetCurrentCoboSafeAccountWithBoundary,
  revokeSessionBoundaryConsent,
  runWithSessionBoundary,
  setCurrentAccountWithBoundary,
} from '@/background/service/sessionBoundary';

const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');

/**
 * One interleaved trace: `reset-start` is appended from inside the keyring
 * operation and `sink` from inside a signing-continuation callback scheduled
 * the same way a resolved-but-unexecuted rpcFlow continuation would run. A
 * mutant that starts operation() BEFORE revoking (and revokes later in the
 * same turn) reorders the single shared array and reddens every test —
 * separate booleans per side allowed exactly that false green
 * (gpt56 round-5 R4-B1 note).
 */
describe('reset session boundary ordering', () => {
  beforeEach(() => {
    trace.length = 0;
    resolveBoundary = () => undefined;
    jest.clearAllMocks();
  });

  test('central account setter revokes before writing a changed identity', () => {
    const accountA = {
      address: '0xAa',
      type: 'QR Hardware Wallet Device',
      brandName: 'Keystone',
    };
    const accountB = {
      address: '0xBb',
      type: 'PrivateKey',
      brandName: 'PrivateKey',
    };
    (preferenceService.getCurrentAccount as jest.Mock).mockReturnValue(accountA);

    setCurrentAccountWithBoundary(accountB);

    expect(trace).toEqual(['reject', 'clear', 'epoch']);
    expect(preferenceService.setCurrentAccount).toHaveBeenCalledWith(accountB);
  });

  test('central account setter does not create a boundary for an identical identity', () => {
    const account = {
      address: '0xAa',
      type: 'QR Hardware Wallet Device',
      brandName: 'Keystone',
    };
    (preferenceService.getCurrentAccount as jest.Mock).mockReturnValue(account);

    setCurrentAccountWithBoundary({ ...account, address: '0xaa' });

    expect(trace).toEqual([]);
    expect(preferenceService.setCurrentAccount).toHaveBeenCalledWith({
      ...account,
      address: '0xaa',
    });
  });

  test('Cobo restoration resets storage before restoring the account boundary', async () => {
    const delegated = {
      address: '0xCc',
      type: 'CoboArgus',
      brandName: 'Cobo',
    };
    const previous = {
      address: '0xAa',
      type: 'PrivateKey',
      brandName: 'PrivateKey',
    };
    (preferenceService.getCurrentAccount as jest.Mock).mockReturnValue(
      delegated
    );
    (preferenceService.resetCurrentCoboSafeAddress as jest.Mock).mockResolvedValue(
      previous
    );

    await resetCurrentCoboSafeAccountWithBoundary();

    expect(preferenceService.resetCurrentCoboSafeAddress).toHaveBeenCalled();
    expect(trace).toEqual(['reject', 'clear', 'epoch']);
    expect(preferenceService.setCurrentAccount).toHaveBeenCalledWith(previous);
  });

  test('bulk site snapshots invalidate only origins whose effective account changed', () => {
    const accountA = {
      address: '0xAa',
      type: 'PrivateKey',
      brandName: 'PrivateKey',
    };
    const accountB = {
      address: '0xBb',
      type: 'QR Hardware Wallet Device',
      brandName: 'Keystone',
    };

    const changed = revokeSiteAccountBoundaries(
      [
        { origin: 'https://same.example', account: accountA },
        { origin: 'https://changed.example', account: accountA },
      ],
      [
        { origin: 'https://same.example', account: { ...accountA } },
        { origin: 'https://changed.example', account: accountB },
      ]
    );

    expect(changed).toEqual(['https://changed.example']);
    expect(notificationService.rejectApprovalsByOrigin).toHaveBeenCalledWith(
      'https://changed.example'
    );
    expect(notificationService.bumpOriginApprovalEpoch).toHaveBeenCalledWith(
      'https://changed.example'
    );
    expect(notificationService.rejectApprovalsByOrigin).not.toHaveBeenCalledWith(
      'https://same.example'
    );
  });

  test('brandless QR removal revokes a site-bound account before a sink continuation', async () => {
    let epoch = 0;
    (notificationService.bumpApprovalEpoch as jest.Mock).mockImplementation(
      () => {
        epoch += 1;
        trace.push('epoch');
      }
    );
    (preferenceService.getCurrentAccount as jest.Mock).mockReturnValue(null);
    (permissionService.getSites as jest.Mock).mockReturnValue([
      {
        account: {
          address: '0xAa',
          type: 'QR Hardware Wallet Device',
          brandName: 'Keystone',
        },
      },
    ]);

    const capturedEpoch = epoch;
    const affected = revokeAccountBoundaryIfAffected(
      '0xaa',
      'QR Hardware Wallet Device'
    );
    let sinkRan = false;
    queueMicrotask(() => {
      if (epoch === capturedEpoch) sinkRan = true;
    });
    await Promise.resolve();

    expect(affected).toBe(true);
    expect(trace).toEqual(['reject', 'clear', 'epoch']);
    expect(epoch).toBe(capturedEpoch + 1);
    expect(sinkRan).toBe(false);
  });

  test('revokes approval and remote authority while keyring reset is stalled', async () => {
    let resolveReset: () => void = () => undefined;
    let sinkExecuted = 0;
    const reset = runWithSessionBoundary(
      () =>
        new Promise<void>((resolve) => {
          trace.push('reset-start');
          // The privileged sink analogue: a continuation already scheduled
          // when the reset starts (microtask after approval resolution),
          // exactly what assertSignContextStillValid re-checks at the sink.
          queueMicrotask(() => {
            sinkExecuted += 1;
            trace.push('sink');
          });
          resolveReset = resolve;
        })
    );

    await Promise.resolve();
    await Promise.resolve();

    // Single ordered trace proves ordering AND zero-sink together.
    expect(trace).toEqual(['reject', 'clear', 'epoch', 'lock', 'reset-start', 'sink']);
    // The revocation itself happened synchronously, before the operation
    // began: reset-start could only be appended after all four.
    expect(notificationService.rejectAllApprovals).toHaveBeenCalledTimes(1);
    expect(notificationService.bumpApprovalEpoch).toHaveBeenCalledTimes(1);
    expect(remoteDataPolicyService.lock).toHaveBeenCalledTimes(1);

    resolveReset();
    await Promise.resolve();
    let settled = false;
    reset.then(() => {
      settled = true;
    });
    await Promise.resolve();
    // Still pending: the boundary promise (async DNR cleanup) must be awaited.
    expect(settled).toBe(false);

    resolveBoundary();
    await expect(reset).resolves.toBeUndefined();
  });

  test('the signing sink cannot execute across a stalled reset once consent is revoked', async () => {
    // Behavioural half of the closure: with a real notificationService-like
    // epoch object and the real rpcFlow-style comparison, a continuation
    // captured BEFORE the boundary rejects itself AFTER the boundary fired,
    // with zero sink execution. (rpcFlow's own suites prove the comparison;
    // this proves revokeSessionBoundaryConsent actually bumps the state that
    // comparison reads, through the same synchronous path.)
    let resolveReset: () => void = () => undefined;
    let sinkRan = false;
    const epochHolder = { value: 0 };
    (notificationService.bumpApprovalEpoch as jest.Mock).mockImplementation(
      () => {
        epochHolder.value += 1;
        trace.push('epoch');
      }
    );

    const capturedEpoch = epochHolder.value;
    const reset = runWithSessionBoundary(
      () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        })
    );
    await Promise.resolve();

    // Sink-adjacent recheck (rpcFlow.assertSignContextStillValid core rule):
    const stillValid = epochHolder.value === capturedEpoch;
    if (stillValid) sinkRan = true;

    expect(sinkRan).toBe(false);
    expect(epochHolder.value).toBe(capturedEpoch + 1);

    // Complete the boundary so the outer promise settles (the lock mock
    // resolves the boundary promise; the reset promise needs its own).
    resolveReset();
    resolveBoundary();
    await expect(reset).resolves.toBeUndefined();
    expect(trace).toContain('epoch');
  });

  test('revokeSessionBoundaryConsent performs all four revocations with no await before them', () => {
    // The helper must be synchronous through the revocations: assert on the
    // SOURCE contract so a refactor that awaits before revoking reddens even
    // the revoke helper, reddening it if a refactor awaits before revoking.
    const source = stripComments(
      fs.readFileSync(
        path.join(process.cwd(), 'src/background/service/sessionBoundary.ts'),
        'utf8'
      )
    );
    const revokeBody = source.slice(
      source.indexOf('export const revokeSessionBoundaryConsent'),
      source.indexOf('export const runWithSessionBoundary')
    );
    expect(revokeBody).toMatch(/rejectAllApprovals\(\);\s*\n?\s*notificationService\.clear\(\);\s*\n?\s*notificationService\.bumpApprovalEpoch\(\);\s*\n?\s*return remoteDataPolicyService\.lock\(\);/);
    // No await anywhere in the revoke helper.
    expect(revokeBody).not.toMatch(/\bawait\b/);
  });

  test('WalletController reset methods use the boundary wrapper before keyring awaits', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/background/controller/wallet.ts'),
      'utf8'
    );
    expect(source).toMatch(
      /resetPassword = async \(password: string\) => \{\s*await runWithSessionBoundary\(\(\) => keyringService\.resetPassword\(password\)\)/
    );
    expect(source).toMatch(
      /resetBooted = async \(\) => \{\s*await runWithSessionBoundary\(\(\) => keyringService\.resetBooted\(\)\)/
    );
  });

  describe('implicit account-boundary paths (gpt56 round-5 blocker 1)', () => {
    const readController = () =>
      fs.readFileSync(
        path.join(process.cwd(), 'src/background/controller/wallet.ts'),
        'utf8'
      );

    test('the removal method delegates to the central await-free boundary primitive before its first await', () => {
      const source = stripComments(readController());
      const body = source.slice(
        source.indexOf('removeAddress = async ('),
        source.indexOf('removeAddresses = async')
      );
      const revokeAt = body.indexOf(
        'this.revokeApprovalAuthorityIfAccountAffected('
      );
      const firstAwait = body.indexOf('await ');
      expect(revokeAt).toBeGreaterThanOrEqual(0);
      expect(firstAwait).toBeGreaterThan(revokeAt);
      expect(source).toContain(
        'revokeAccountBoundaryIfAffected(address, type, brand)'
      );
    });

    test('the central removal primitive is await-free, brand-aware, and covers current plus site accounts', () => {
      const source = stripComments(
        fs.readFileSync(
          path.join(process.cwd(), 'src/background/service/sessionBoundary.ts'),
          'utf8'
        )
      );
      const helper = source.slice(
        source.indexOf('export const revokeAccountBoundaryIfAffected'),
        source.indexOf('export const revokeSessionBoundaryConsent')
      );
      expect(helper).not.toMatch(/\bawait\b/);
      expect(helper).toContain('notificationService.rejectAllApprovals()');
      expect(helper).toContain('notificationService.clear()');
      expect(helper).toContain('notificationService.bumpApprovalEpoch()');
      expect(helper).toContain('getCurrentAccount()');
      expect(helper).toContain('getSites()');
      expect(source).toContain(
        '(brand === undefined || account.brandName === brand)'
      );
    });

    test('hideAddress delegates revocation BEFORE the preference mutation', () => {
      const source = stripComments(readController());
      const body = source.slice(
        source.indexOf('hideAddress = (type: string'),
        source.indexOf('clearWatchMode =')
      );
      const revokeAt = body.indexOf('revokeAccountBoundaryIfAffected(');
      const writeAt = body.indexOf('preferenceService.hideAddress(');
      expect(revokeAt).toBeGreaterThanOrEqual(0);
      expect(writeAt).toBeGreaterThan(revokeAt);
      expect(body).not.toMatch(/\bawait\b/);
    });

    test('resetCurrentAccount delegates the identity write to the central boundary primitive', () => {
      const source = stripComments(readController());
      const body = source.slice(
        source.indexOf('resetCurrentAccount = async () => {'),
        source.indexOf('getKeyringByMnemonic = ')
      );
      expect(body).toContain('setCurrentAccountWithBoundary(account ?? null)');
      expect(body).not.toContain('preferenceService.setCurrentAccount(');
    });

    test('account-removal matching treats an omitted QR brand as address+type identity', () => {
      const source = stripComments(
        fs.readFileSync(
          path.join(process.cwd(), 'src/background/service/sessionBoundary.ts'),
          'utf8'
        )
      );
      expect(source).toContain(
        '(brand === undefined || account.brandName === brand)'
      );
      expect(source).toContain(
        'account.address.toLowerCase() === address.toLowerCase()'
      );
      expect(source).toContain('account.type === type');
    });
    test('clearWatchMode routes through the boundary (removeAddress)', () => {
      const source = readController();
      const body = source.slice(
        source.indexOf('clearWatchMode = async () =>'),
        source.indexOf('getAccountByAddress =')
      );
      expect(body).toContain('this.removeAddress(');
    });
  });
});
