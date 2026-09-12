/**
 * @jest-environment node
 */
// gpt56 round-10 blocker 5 + round-12 blocker 5: behavioral coverage of the
// attempt-correlated WalletConnect readiness acknowledgement used by
// WatchAddressWaiting. Success paths must be CORRELATED (this attempt's
// id / this account), uncorrelated global traffic must be ignored, and the
// classic paths (URI, CONNECTED, SUBMITTED, FAILED/REJECTED, kick throw,
// timeout, abort, cleanup) stay covered.

import {
  createWalletConnectReadinessAck,
  type WcAckEvents,
  type WcAckStatus,
} from '@/ui/utils/wcInitAck';

const EVENTS: WcAckEvents = {
  inited: 'WALLETCONNECT.INITED',
  statusChanged: 'WALLETCONNECT.STATUS_CHANGED',
};
const STATUS: WcAckStatus = {
  PENDING: 0,
  WAITING: 1,
  CONNECTING: 2,
  CONNECTED: 3,
  SUBMITTING: 4,
  SUBMITTED: 5,
  REJECTED: 6,
  FAILED: 7,
};

const ACCOUNT = { address: '0xAccountA', brandName: 'WalletConnect' };

const setup = (
  opts: {
    kickThrows?: boolean;
    timeoutMs?: number;
    attemptId?: string;
    expectedAccount?: { address?: string; brandName?: string } | undefined;
  } = {}
) => {
  const listeners = new Map<string, Set<(p: any) => void>>();
  const emit = (event: string, payload: any) => {
    listeners.get(event)?.forEach((h) => h(payload));
  };
  let kicked = 0;
  let kickedAttemptId: string | null = null;
  let timerCb: (() => void) | null = null;
  let timerCleared = false;
  const attemptId = opts.attemptId ?? 'attempt-1';
  const ack = createWalletConnectReadinessAck({
    events: EVENTS,
    statusMap: STATUS,
    addListener: (event, handler) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(handler);
    },
    removeListener: (event, handler) => {
      listeners.get(event)?.delete(handler);
    },
    attemptId,
    expectedAccount: 'expectedAccount' in opts ? opts.expectedAccount : ACCOUNT,
    kickInit: (id) => {
      kicked += 1;
      kickedAttemptId = id;
      if (opts.kickThrows) throw new Error('background port closed');
    },
    timeoutMs: opts.timeoutMs ?? 30_000,
    setTimer: (cb) => {
      timerCb = cb;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      timerCleared = true;
    },
  });
  return {
    ack,
    emit,
    attemptId,
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    kicked: () => kicked,
    kickedAttemptId: () => kickedAttemptId,
    fireTimeout: () => timerCb?.(),
    timerCleared: () => timerCleared,
  };
};

const settled = async (p: Promise<'ready'>): Promise<'ready' | Error> => {
  try {
    return await p;
  } catch (e) {
    return e as Error;
  }
};

describe('WalletConnect readiness acknowledgement (r10-B5 + r12-B5)', () => {
  test('kick carries the attempt id', () => {
    const env = setup();
    expect(env.kickedAttemptId()).toBe(env.attemptId);
  });

  test('correlated INITED pairing URI acknowledges readiness and removes listeners', async () => {
    const env = setup();
    expect(env.listenerCount(EVENTS.inited)).toBe(1);
    env.emit(EVENTS.inited, { uri: 'wc:pair@2', attemptId: env.attemptId });
    expect(await settled(env.ack.promise)).toBe('ready');
    expect(env.listenerCount(EVENTS.inited)).toBe(0);
    expect(env.listenerCount(EVENTS.statusChanged)).toBe(0);
    expect(env.timerCleared()).toBe(true);
  });

  test('INITED from a DIFFERENT attempt id is ignored (late/foreign init)', async () => {
    const env = setup();
    env.emit(EVENTS.inited, { uri: 'wc:stale@2', attemptId: 'attempt-OLD' });
    expect(env.ack.isSettled()).toBe(false);
    // still settles for the correct attempt
    env.emit(EVENTS.inited, { uri: 'wc:mine@2', attemptId: env.attemptId });
    expect(await settled(env.ack.promise)).toBe('ready');
  });

  test('INITED with no attempt id at all is ignored (uncorrelated emitter)', async () => {
    const env = setup();
    env.emit(EVENTS.inited, { uri: 'wc:no-attempt@2' });
    expect(env.ack.isSettled()).toBe(false);
  });

  test('CONNECTED for a different account is ignored; same account settles', async () => {
    const env = setup();
    env.emit(EVENTS.statusChanged, {
      status: STATUS.CONNECTED,
      account: { address: '0xOther', brandName: 'WalletConnect' },
    });
    expect(env.ack.isSettled()).toBe(false);
    env.emit(EVENTS.statusChanged, {
      status: STATUS.CONNECTED,
      account: { address: '0xACCOUNTA', brandName: 'WalletConnect' },
    });
    expect(await settled(env.ack.promise)).toBe('ready');
  });

  test('SUBMITTED for the expected account acknowledges; transitional statuses do not', async () => {
    const env = setup();
    env.emit(EVENTS.statusChanged, {
      status: STATUS.WAITING,
      account: ACCOUNT,
    });
    env.emit(EVENTS.statusChanged, {
      status: STATUS.CONNECTING,
      account: ACCOUNT,
    });
    expect(env.ack.isSettled()).toBe(false);
    env.emit(EVENTS.statusChanged, {
      status: STATUS.SUBMITTED,
      account: ACCOUNT,
    });
    expect(await settled(env.ack.promise)).toBe('ready');
  });

  test('FAILED or REJECTED status for the expected account rejects the ack', async () => {
    const env = setup();
    env.emit(EVENTS.statusChanged, {
      status: STATUS.FAILED,
      account: ACCOUNT,
    });
    const outcome = await settled(env.ack.promise);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/failed/i);
    expect(env.listenerCount(EVENTS.statusChanged)).toBe(0);
  });

  test('FAILED for a DIFFERENT account does not sink this attempt', async () => {
    const env = setup();
    env.emit(EVENTS.statusChanged, {
      status: STATUS.FAILED,
      account: { address: '0xOther', brandName: 'WalletConnect' },
    });
    expect(env.ack.isSettled()).toBe(false);
    env.emit(EVENTS.inited, { uri: 'wc:pair@2', attemptId: env.attemptId });
    expect(await settled(env.ack.promise)).toBe('ready');
  });

  test('failure-then-success on the same account: failure wins (no second chance)', async () => {
    // A terminal FAILED settles the ack rejected; the caller must re-init a
    // fresh attempt rather than reuse a sunk ack.
    const env = setup();
    env.emit(EVENTS.statusChanged, {
      status: STATUS.FAILED,
      account: ACCOUNT,
    });
    const outcome = await settled(env.ack.promise);
    expect(outcome).toBeInstanceOf(Error);
    env.emit(EVENTS.statusChanged, {
      status: STATUS.CONNECTED,
      account: ACCOUNT,
    });
    // promise remains rejected; late success does not flip settlement
    expect(await settled(env.ack.promise)).toBeInstanceOf(Error);
  });

  test('INITED for our attempt id but without a URI rejects instead of hanging', async () => {
    const env = setup();
    env.emit(EVENTS.inited, { attemptId: env.attemptId });
    const outcome = await settled(env.ack.promise);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/no pairing URI/i);
  });

  test('kick failure rejects synchronously with the error surfaced', async () => {
    const env = setup({ kickThrows: true });
    const outcome = await settled(env.ack.promise);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/background port closed/);
    expect(env.listenerCount(EVENTS.inited)).toBe(0);
  });

  test('timeout rejects and cleans up', async () => {
    const env = setup();
    env.fireTimeout();
    const outcome = await settled(env.ack.promise);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/timed out/i);
    expect(env.listenerCount(EVENTS.statusChanged)).toBe(0);
  });

  test('abort cancels a pending acknowledgement and is idempotent after settle', async () => {
    const env = setup();
    env.ack.abort('unmounted');
    const outcome = await settled(env.ack.promise);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/unmounted/);
    env.ack.abort('again');
    expect(env.listenerCount(EVENTS.inited)).toBe(0);
  });

  test('duplicate late events after settle do not re-resolve or throw', async () => {
    const env = setup();
    env.emit(EVENTS.inited, { uri: 'wc:first@2', attemptId: env.attemptId });
    expect(await settled(env.ack.promise)).toBe('ready');
    expect(() =>
      env.emit(EVENTS.statusChanged, {
        status: STATUS.FAILED,
        account: ACCOUNT,
      })
    ).not.toThrow();
    expect(() =>
      env.emit(EVENTS.inited, {
        uri: 'wc:second@2',
        attemptId: env.attemptId,
      })
    ).not.toThrow();
  });

  test('concurrent attempts: only the LATEST attempt id settles each ack', async () => {
    // Simulates retry while the first attempt is still pending: attempt-2's
    // events must not settle attempt-1's ack and vice versa.
    const first = setup({ attemptId: 'attempt-1' });
    const second = setup({ attemptId: 'attempt-2' });
    second.emit(EVENTS.inited, { uri: 'wc:p2@2', attemptId: 'attempt-2' });
    expect(first.ack.isSettled()).toBe(false);
    expect(await settled(second.ack.promise)).toBe('ready');
    first.emit(EVENTS.inited, { uri: 'wc:p1@2', attemptId: 'attempt-1' });
    expect(await settled(first.ack.promise)).toBe('ready');
  });

  test('no account expectation (undefined) accepts account-less transitions', async () => {
    const env = setup({ expectedAccount: undefined });
    env.emit(EVENTS.statusChanged, { status: STATUS.CONNECTED });
    expect(await settled(env.ack.promise)).toBe('ready');
  });
});
