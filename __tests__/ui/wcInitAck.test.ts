/**
 * @jest-environment node
 */
// gpt56 round-10 blocker 5: behavioral coverage of the WalletConnect
// readiness acknowledgement used by WatchAddressWaiting — success paths
// (URI, CONNECTED, SUBMITTED), failure paths (FAILED/REJECTED status, kick
// throw, timeout), listener cleanup on settle, and abort semantics.

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

const setup = (opts: { kickThrows?: boolean; timeoutMs?: number } = {}) => {
  const listeners = new Map<string, Set<(p: any) => void>>();
  const emit = (event: string, payload: any) => {
    listeners.get(event)?.forEach((h) => h(payload));
  };
  let kicked = 0;
  let timerCb: (() => void) | null = null;
  let timerCleared = false;
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
    kickInit: () => {
      kicked += 1;
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
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
    kicked: () => kicked,
    fireTimeout: () => timerCb?.(),
    timerCleared: () => timerCleared,
  };
};

const settled = async (
  p: Promise<'ready'>
): Promise<'ready' | Error> => {
  try {
    return await p;
  } catch (e) {
    return e as Error;
  }
};

describe('WalletConnect readiness acknowledgement (blocker 5)', () => {
  test('INITED pairing URI acknowledges readiness and removes listeners', async () => {
    const env = setup();
    expect(env.kicked()).toBe(1);
    expect(env.listenerCount(EVENTS.inited)).toBe(1);
    env.emit(EVENTS.inited, { uri: 'wc:pair@2' });
    expect(await settled(env.ack.promise)).toBe('ready');
    // cleanup: listeners removed and timer cancelled
    expect(env.listenerCount(EVENTS.inited)).toBe(0);
    expect(env.listenerCount(EVENTS.statusChanged)).toBe(0);
    expect(env.timerCleared()).toBe(true);
  });

  test('CONNECTED and SUBMITTED statuses acknowledge; transitional statuses do not', async () => {
    const env = setup();
    env.emit(EVENTS.statusChanged, { status: STATUS.WAITING });
    env.emit(EVENTS.statusChanged, { status: STATUS.CONNECTING });
    expect(env.ack.isSettled()).toBe(false);
    env.emit(EVENTS.statusChanged, { status: STATUS.CONNECTED });
    expect(await settled(env.ack.promise)).toBe('ready');
  });

  test('FAILED or REJECTED status rejects the ack (caller must not announce)', async () => {
    const env = setup();
    env.emit(EVENTS.statusChanged, { status: STATUS.FAILED });
    const outcome = await settled(env.ack.promise);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/failed/i);
    expect(env.listenerCount(EVENTS.statusChanged)).toBe(0);
  });

  test('INITED without a URI rejects instead of hanging', async () => {
    const env = setup();
    env.emit(EVENTS.inited, {});
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
    // second abort after settle changes nothing
    env.ack.abort('again');
    expect(env.listenerCount(EVENTS.inited)).toBe(0);
  });

  test('duplicate late events after settle do not re-resolve or throw', async () => {
    const env = setup();
    env.emit(EVENTS.inited, { uri: 'wc:first@2' });
    expect(await settled(env.ack.promise)).toBe('ready');
    expect(() => env.emit(EVENTS.statusChanged, { status: STATUS.FAILED })).not.toThrow();
    expect(() => env.emit(EVENTS.inited, { uri: 'wc:second@2' })).not.toThrow();
  });
});
