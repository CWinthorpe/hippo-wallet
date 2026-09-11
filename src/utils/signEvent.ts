import { EVENTS } from '@/constant';
import eventBus from '@/eventBus';
import type { AuthorityContext } from '@/background/service/sessionBoundary';

/**
 * Handshake binding for the dApp sign lifecycle.
 *
 * Identity is the OPERATION, not the approval window that renders. One
 * rpcFlow request can span two approvals: the parent dApp approval (A,
 * component SignText/SignTypedData/SignTx) and the waiting-component
 * approval (B, e.g. LedgerHardwareWaiting) created from A's resolved data.
 * The background waiter and the UI emitter must therefore agree on A's id,
 * A's component, and the AuthorityContext captured when A was created —
 * fields B receives verbatim through the resolve payload (__approvalId,
 * __approvalComponent, __signingContext).
 */
export type SignEventBinding = {
  /** Parent (dApp-facing) approval id — NOT the waiting child's own id. */
  approvalId: string;
  /** Parent approval component (SignText/SignTypedData/SignTx). */
  approvalComponent: string;
  authorityContext: AuthorityContext;
};

/** A broadcast SIGN_FINISHED/SIGN_WAITING payload adds the completion fields. */
export type SignEventData = Partial<SignEventBinding> & {
  success?: boolean;
  data?: unknown;
  errorMsg?: string;
};

const CONTEXT_FIELDS: (keyof AuthorityContext)[] = [
  'operationId',
  'origin',
  'requestDigest',
  'approvalEpoch',
  'originEpoch',
  'boundChain',
  'internalOrigin',
  'approvalComponent',
];

const sameAuthorityContext = (a?: AuthorityContext, b?: AuthorityContext) => {
  if (!a || !b) return false;
  if (
    !CONTEXT_FIELDS.every((field) => a[field] === b[field]) ||
    a.boundAccount?.address !== b.boundAccount?.address ||
    a.boundAccount?.type !== b.boundAccount?.type ||
    a.boundAccount?.brandName !== b.boundAccount?.brandName
  ) {
    return false;
  }
  return true;
};

export const matchesSignEvent = (
  data: Partial<SignEventBinding> | undefined,
  binding: Partial<SignEventBinding> | undefined
) =>
  !!data?.approvalId &&
  !!data?.approvalComponent &&
  !!binding?.approvalId &&
  !!binding?.approvalComponent &&
  data.approvalId === binding.approvalId &&
  data.approvalComponent === binding.approvalComponent &&
  sameAuthorityContext(data.authorityContext, binding.authorityContext);

/**
 * Derive the handshake binding an approval renders with. Parent approvals
 * carry the context on params.$signingContext; waiting children carry the
 * parent's identity through the resolve-attached fields. Returns undefined
 * when the approval does not belong to a signing operation at all.
 */
export const bindSignEventFromApproval = (approval?: {
  id?: string;
  data?: any;
}): Partial<SignEventBinding> | undefined => {
  if (!approval) return undefined;
  const params = approval.data?.params || {};
  const authorityContext =
    params.$signingContext || params.__signingContext || undefined;
  const approvalId = params.__approvalId || approval.id;
  const approvalComponent =
    params.__approvalComponent ||
    (authorityContext ? approval.data?.approvalComponent : undefined);
  if (!approvalId || !approvalComponent || !authorityContext) return undefined;
  return { approvalId, approvalComponent, authorityContext };
};

/**
 * UI-side one-shot gate (gpt56 round-9 blocker 3). A SUCCESS completion is
 * the "first valid event": exactly one per mount is accepted and the caller
 * must detach synchronously before running any effect, so a duplicated,
 * replayed, or late event can never re-run the completion branch (and its
 * irreversible Gnosis/Cobo effects). A FAILURE completion does not consume
 * the gate — the legitimate resend flow re-drives the same operation and
 * must still be able to deliver a later success to the same mounted
 * component.
 */
export const createSignEventConsumer = (
  getBinding: (approval?: any) => Partial<SignEventBinding>
) => {
  let consumed = false;
  return {
    /** true = handle this event; sets terminal state on success. */
    tryConsume: (data: SignEventData | undefined) => {
      if (consumed) return false;
      if (!matchesSignEvent(data, getBinding())) return false;
      if (data?.success !== false) consumed = true;
      return true;
    },
    /** true once a success completion has been accepted (detach time). */
    isTerminal: (data: SignEventData | undefined) => data?.success !== false,
    isConsumed: () => consumed,
  };
};

/**
 * Background-owned one-shot registry (this module's waiters only ever run in
 * the service-worker context). Exactly one live waiter exists per parent
 * approval id: re-registering (resendSign retry) detaches the previous
 * listener so one AMOUNTED event can never settle two generations of the
 * same operation, and a consumed event is never re-delivered. Rejection or
 * teardown of the owning approval CANCELS the waiter with an explicit error
 * (gpt56 round-10 blocker 1) so a cancelled signing continuation can never
 * proceed to its sink, and no stale waiter survives to accept a later
 * matching event.
 */
type WaiterEntry = {
  listener: (data?: Partial<SignEventBinding>) => void;
  reject: (err: unknown) => void;
  settled: boolean;
};

const activeWaiters = new Map<string, WaiterEntry>();

export const waitSignComponentAmounted = (
  binding: SignEventBinding
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const key = binding.approvalId;
    cancelSignComponentWait(
      key,
      new Error('Superseded by a newer signing generation; approve again.')
    );
    const entry: WaiterEntry = {
      listener: () => undefined,
      reject: () => undefined,
      settled: false,
    };
    entry.listener = (data?: Partial<SignEventBinding>) => {
      if (entry.settled) return;
      if (!matchesSignEvent(data, binding)) return;
      entry.settled = true;
      eventBus.removeEventListener(
        EVENTS.SIGN_WAITING_AMOUNTED,
        entry.listener
      );
      if (activeWaiters.get(key) === entry) activeWaiters.delete(key);
      resolve();
    };
    entry.reject = (err: unknown) => {
      if (entry.settled) return;
      entry.settled = true;
      eventBus.removeEventListener(
        EVENTS.SIGN_WAITING_AMOUNTED,
        entry.listener
      );
      if (activeWaiters.get(key) === entry) activeWaiters.delete(key);
      reject(err);
    };
    activeWaiters.set(key, entry);
    eventBus.addEventListener(EVENTS.SIGN_WAITING_AMOUNTED, entry.listener);
  });

/** Cancel a waiter (approval rejected/closed) with an explicit rejection. */
export const cancelSignComponentWait = (approvalId: string, err?: unknown) => {
  const previous = activeWaiters.get(approvalId);
  if (previous) {
    activeWaiters.delete(approvalId);
    eventBus.removeEventListener(
      EVENTS.SIGN_WAITING_AMOUNTED,
      previous.listener
    );
    previous.reject(
      err ?? new Error('Signing request was cancelled; approve again.')
    );
  }
};

/** Test/inspection only: is a waiter currently registered for this id? */
export const hasSignComponentWaiter = (approvalId: string) =>
  activeWaiters.has(approvalId);

// only work in UI
export const emitSignComponentAmounted = (
  binding?: Partial<SignEventBinding>
) => {
  // A waiting event without an exact operation binding is not consent. Do
  // not broadcast an unscoped signal another window could consume.
  if (!matchesSignEvent(binding, binding)) return;
  const data = binding as SignEventBinding;
  eventBus.emit(EVENTS.broadcastToBackground, {
    method: EVENTS.SIGN_WAITING_AMOUNTED,
    data,
  });
  eventBus.emit(EVENTS.SIGN_WAITING_AMOUNTED, data);
};
