import { EVENTS } from '@/constant';
import eventBus from '@/eventBus';
import type { AuthorityContext } from '@/background/service/sessionBoundary';

export type SignEventBinding = {
  approvalId: string;
  approvalComponent: string;
  authorityContext: AuthorityContext;
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

export const waitSignComponentAmounted = (
  binding: SignEventBinding
): Promise<void> =>
  new Promise<void>((resolve) => {
    const listener = (data?: Partial<SignEventBinding>) => {
      if (!matchesSignEvent(data, binding)) return;
      eventBus.removeEventListener(EVENTS.SIGN_WAITING_AMOUNTED, listener);
      resolve();
    };
    eventBus.addEventListener(EVENTS.SIGN_WAITING_AMOUNTED, listener);
  });

// only work in UI
export const emitSignComponentAmounted = (
  binding?: Partial<SignEventBinding>
) => {
  // A waiting event without an exact approval and authority binding is not
  // consent. Do not broadcast an unscoped signal another window could consume.
  if (!matchesSignEvent(binding, binding)) return;
  const data = binding as SignEventBinding;
  eventBus.emit(EVENTS.broadcastToBackground, {
    method: EVENTS.SIGN_WAITING_AMOUNTED,
    data,
  });
  eventBus.emit(EVENTS.SIGN_WAITING_AMOUNTED, data);
};
