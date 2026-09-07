let resolveBoundary: () => void;
const trace: string[] = [];

jest.mock('@/background/service/notification', () => ({
  __esModule: true,
  default: {
    rejectAllApprovals: jest.fn(() => trace.push('reject')),
    clear: jest.fn(() => trace.push('clear')),
    bumpApprovalEpoch: jest.fn(() => trace.push('epoch')),
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

import fs from 'fs';
import path from 'path';
import notificationService from '@/background/service/notification';
import remoteDataPolicyService from '@/background/service/remoteDataPolicy';
import {
  revokeSessionBoundaryConsent,
  runWithSessionBoundary,
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

    test('removeAddress revokes synchronously before its first await', () => {
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
    });

    test('the removal revocation helper is await-free and bumps the global epoch', () => {
      const source = readController();
      const helper = source.slice(
        source.indexOf(
          'private revokeApprovalAuthorityIfAccountAffected'
        ),
        source.indexOf('removeAddress = async (')
      );
      expect(helper).not.toMatch(/\bawait\b/);
      expect(helper).toContain('notificationService.rejectAllApprovals()');
      expect(helper).toContain('notificationService.clear()');
      expect(helper).toContain('notificationService.bumpApprovalEpoch()');
      // Covers BOTH the current account and site-bound accounts.
      expect(helper).toContain('getCurrentAccount()');
      expect(helper).toContain('getSites()');
    });

    test('hideAddress revokes BEFORE the preference mutation, in one synchronous turn', () => {
      const source = stripComments(readController());
      const body = source.slice(
        source.indexOf('hideAddress = (type: string'),
        source.indexOf('clearWatchMode =')
      );
      const revokeAt = body.indexOf('notificationService.bumpApprovalEpoch()');
      const writeAt = body.indexOf('preferenceService.hideAddress(');
      expect(revokeAt).toBeGreaterThanOrEqual(0);
      expect(writeAt).toBeGreaterThan(revokeAt);
      expect(body).not.toMatch(/\bawait\b/);
    });

    test('resetCurrentAccount revokes in the same synchronous turn as the account write', () => {
      const source = stripComments(readController());
      const body = source.slice(
        source.indexOf('resetCurrentAccount = async () => {'),
        source.indexOf('getKeyringByMnemonic = ')
      );
      const writeAt = body.indexOf('preferenceService.setCurrentAccount(next)');
      const revokeAt = body.indexOf('notificationService.bumpApprovalEpoch()');
      expect(writeAt).toBeGreaterThanOrEqual(0);
      expect(revokeAt).toBeGreaterThan(writeAt);
      // No await between the write and the revocation.
      const between = body.slice(writeAt, revokeAt);
      expect(between).not.toMatch(/\bawait\b/);
      expect(body).toContain('const switched');
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
