export interface PendingApprovalIdentity {
  id?: string;
  data?: {
    approvalComponent?: unknown;
  };
}

interface RouteNotificationAfterUnlockOptions {
  getApproval: () => Promise<PendingApprovalIdentity | null | undefined>;
  resolveApproval: (
    data?: unknown,
    stay?: boolean,
    forceReject?: boolean,
    approvalId?: string
  ) => Promise<unknown> | unknown;
  replace: (path: string) => void;
  /**
   * The approval this window actually rendered, captured at mount. The
   * global `UNLOCK_WALLET` event carries no window/request identity, so a
   * stale window must never resolve an approval it did not render.
   */
  expectedApprovalId?: string;
}

/**
 * Route a notification window after authentication without treating the
 * unlock gesture as consent for an unrelated pending request, and without
 * letting a stale window resolve an approval it never rendered.
 *
 * Fail-closed rules:
 * - No approval pending at all -> close the window to the initial route.
 * - The pending approval is not an Unlock approval -> explicit review UI.
 * - The pending approval is not the one this window rendered -> explicit
 *   review UI, never auto-resolve.
 * - Only an Unlock approval with the exact captured id is auto-resolved.
 */
export const routeNotificationAfterUnlock = async ({
  getApproval,
  resolveApproval,
  replace,
  expectedApprovalId,
}: RouteNotificationAfterUnlockOptions) => {
  const approval = await getApproval();
  if (!approval) {
    replace('/');
    return;
  }

  const isUnlockApproval =
    String(approval.data?.approvalComponent) === 'Unlock';
  const approvalId = approval.id;

  const boundToThisWindow =
    typeof expectedApprovalId === 'string' &&
    Boolean(expectedApprovalId) &&
    approvalId === expectedApprovalId;

  if (
    !isUnlockApproval ||
    typeof approvalId !== 'string' ||
    !approvalId ||
    !boundToThisWindow
  ) {
    replace('/approval');
    return;
  }

  await resolveApproval(undefined, false, false, approvalId);
};
