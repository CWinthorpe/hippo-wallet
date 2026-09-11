/**
 * gpt56 round-10 blocker 5: WalletConnect readiness acknowledgement helper.
 *
 * The waiting-component UI must not announce readiness (SIGN_WAITING_AMOUNTED)
 * before the keyring initialization is actually acknowledged, and every
 * listener it registers for that wait must be removable so retries and
 * unmounts cannot leave stale consumers behind. This module keeps the
 * acknowledgement state machine out of the React component so it can be
 * exercised behaviorally.
 */

export type WcAckEvents = {
  /** Fires with { uri } once the connector produced a pairing URI. */
  inited: string;
  /** Fires with { status, payload } on connector status transitions. */
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

export type WcAckDeps = {
  events: WcAckEvents;
  statusMap: WcAckStatus;
  addListener: (event: string, handler: (payload: any) => void) => void;
  removeListener: (event: string, handler: (payload: any) => void) => void;
  /** Kick the background initialization; called exactly once per attempt. */
  kickInit: () => void;
  timeoutMs?: number;
  setTimer?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
};

export type WcAckHandle = {
  /** Resolves 'ready' on INITED-uri / CONNECTED / SUBMITTED acknowledgement. */
  promise: Promise<'ready'>;
  /** Remove listeners + timer and reject. Safe to call after settlement. */
  abort: (reason?: string) => void;
  isSettled: () => boolean;
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
      // A pairing URI is the explicit success acknowledgement.
      if (payload && typeof payload.uri === 'string' && payload.uri) {
        succeed();
      } else {
        fail('WalletConnect initialization returned no pairing URI.');
      }
    };
    statusHandler = (payload: any) => {
      const status = payload?.status;
      if (status === statusMap.CONNECTED || status === statusMap.SUBMITTED) {
        succeed();
      } else if (status === statusMap.FAILED || status === statusMap.REJECTED) {
        // CONNECTING/ WAITING are transitional, not failures.
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
      kickInit();
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
