/**
 * gpt56 round-10 blocker 5 + round-12 blocker 5: WalletConnect readiness
 * acknowledgement helper.
 *
 * The waiting-component UI must not announce readiness (SIGN_WAITING_AMOUNTED)
 * before the keyring initialization is actually acknowledged, and every
 * listener it registers for that wait must be removable so retries and
 * unmounts cannot leave stale consumers behind. This module keeps the
 * acknowledgement state machine out of the React component so it can be
 * exercised behaviorally.
 *
 * Round-12 hardening: the raw broadcasts are GLOBAL — a parallel
 * WalletConnect/Coinbase init from anywhere else, another window, or a late
 * event from an aborted/retried attempt used to settle the current
 * acknowledgement. Every accepted signal must now correlate with THIS
 * attempt: the INITED broadcast echoes the attemptId the UI stamped on its
 * kick, and CONNECTED/SUBMITTED status transitions must match the expected
 * account. Uncorrelated events are ignored (fail closed; the timeout still
 * fails the ack if no correlated event ever arrives).
 */

export type WcAckEvents = {
  /** Fires with { uri, attemptId } once the connector produced a pairing URI. */
  inited: string;
  /** Fires with { status, account, payload } on connector status transitions. */
  statusChanged: string;
};

export type WcAckStatus = {
  CONNECTED: string | number;
  SUBMITTED: string | number;
  WAITING: string | number;
  FAILED: string | number;
  REJECTED: string | number;
  CONNECTING?: string | number;
  [k: string]: string | number | undefined;
};

export type WcAckAccount = {
  address?: string;
  brandName?: string;
};

export type WcAckDeps = {
  events: WcAckEvents;
  statusMap: WcAckStatus;
  addListener: (event: string, handler: (payload: any) => void) => void;
  removeListener: (event: string, handler: (payload: any) => void) => void;
  /** Kick the background initialization; called exactly once per attempt. */
  kickInit: (attemptId: string) => void;
  /**
   * Unpredictable attempt id stamped on this ack's kick. Only INITED
   * broadcasts carrying the SAME id correlate to this attempt.
   */
  attemptId: string;
  /**
   * The account this attempt drives. CONNECTED/SUBMITTED transitions for a
   * different account are another session's traffic and are ignored.
   */
  expectedAccount?: WcAckAccount;
  timeoutMs?: number;
  setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
};

export type WcAckHandle = {
  /** Resolves 'ready' on correlated INITED-uri / CONNECTED / SUBMITTED ack. */
  promise: Promise<'ready'>;
  /** Remove listeners + timer and reject. Safe to call after settlement. */
  abort: (reason?: string) => void;
  isSettled: () => boolean;
};

const sameAccount = (a: any, b?: WcAckAccount) => {
  if (!b) return true;
  const addrA = typeof a?.address === 'string' ? a.address.toLowerCase() : '';
  const addrB =
    typeof b.address === 'string' ? b.address.toLowerCase() : undefined;
  if (addrB !== undefined && addrA !== addrB) return false;
  if (b.brandName !== undefined && a?.brandName !== b.brandName) return false;
  return true;
};

export const createWalletConnectReadinessAck = (
  deps: WcAckDeps
): WcAckHandle => {
  const {
    events,
    statusMap,
    addListener,
    removeListener,
    kickInit,
    attemptId,
    expectedAccount,
    timeoutMs = 30_000,
    setTimer = (cb, ms) => setTimeout(cb, ms),
    clearTimer = (handle) => clearTimeout(handle),
  } = deps;

  let settled = false;
  let initedHandler: ((payload: any) => void) | null = null;
  let statusHandler: ((payload: any) => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let rejectPromise: (err: Error) => void = () => undefined;

  const cleanup = () => {
    if (initedHandler) removeListener(events.inited, initedHandler);
    if (statusHandler) removeListener(events.statusChanged, statusHandler);
    initedHandler = null;
    statusHandler = null;
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const fail = (message: string) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectPromise(new Error(message));
  };
  const succeed = () => {
    if (settled) return;
    settled = true;
    cleanup();
    resolveRef('ready');
  };

  let resolveRef: (v: 'ready') => void = () => undefined;
  const promise = new Promise<'ready'>((resolve, reject) => {
    resolveRef = resolve;
    rejectPromise = reject;

    initedHandler = (payload: any) => {
      // Only THIS attempt's pairing URI counts. A broadcast from another
      // init (different attempt id, or an uncorrelated legacy emitter)
      // neither succeeds nor fails this ack — it stays pending.
      if (payload?.attemptId !== attemptId) return;
      if (payload && typeof payload.uri === 'string' && payload.uri) {
        succeed();
      } else {
        fail('WalletConnect initialization returned no pairing URI.');
      }
    };
    statusHandler = (payload: any) => {
      const status = payload?.status;
      // CONNECTING / WAITING are transitional, not failures.
      const isTerminalSuccess =
        status === statusMap.CONNECTED || status === statusMap.SUBMITTED;
      const isTerminalFailure =
        status === statusMap.FAILED || status === statusMap.REJECTED;
      if (!isTerminalSuccess && !isTerminalFailure) return;
      // Account-scoped transitions only (gpt56 round-12 blocker 5): a
      // CONNECTED for a different session account is another surface's
      // traffic and must never settle this ack.
      if (!sameAccount(payload?.account, expectedAccount)) return;
      if (isTerminalSuccess) {
        succeed();
      } else {
        fail('WalletConnect initialization failed.');
      }
    };

    addListener(events.inited, initedHandler);
    addListener(events.statusChanged, statusHandler);
    timer = setTimer(
      () => fail('WalletConnect initialization timed out.'),
      timeoutMs
    );

    try {
      kickInit(attemptId);
    } catch (e: any) {
      fail(`WalletConnect initialization error: ${e?.message || e}`);
    }
  });
  // A rejected ack must never surface as an unhandled rejection at the call
  // site that forgot to attach a handler; consumers DO attach .catch, this is
  // belt-and-braces for abort-after-settle races.
  promise.catch(() => undefined);

  return {
    promise,
    abort: (reason = 'WalletConnect initialization aborted.') => {
      fail(reason);
    },
    isSettled: () => settled,
  };
};
