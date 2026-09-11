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
  rejectApproval?: (
    err?: string,
    stay?: boolean,
    isInternal?: boolean,
    approvalId?: string
  ) => Promise<unknown> | unknown;
  replace: (path: string) => void;
  /**
   * The approval this window actually rendered, captured at mount. The
   * global `UNLOCK_WALLET` event carries no window/request identity, so a
   * stale window must never resolve an approval it did not render.
   */
  expectedApprovalId?: string;
  /**
   * gpt56 round-10 blocker 4: true only when THIS window performed the
   * password/biometric gesture the success event is answering. A global
   * UNLOCK_WALLET broadcast is transport, not consent — an unrelated window
   * unlocking the wallet must never resume a dApp request queued here.
   */
  localGesture?: boolean;
}

/**
 * Route a notification window after authentication without treating the
 * unlock gesture as consent for an unrelated pending request, without
 * letting a stale window resolve an approval it did not render, and without
 * letting a GLOBAL unlock broadcast act as consent for this window's Unlock
 * approval.
 *
 * Fail-closed rules:
 * - No approval pending at all -> close the window to the initial route.
 * - The pending approval is not an Unlock approval -> explicit review UI.
 * - The pending approval is not the one this window rendered -> explicit
 *   review UI, never auto-resolve.
 * - An Unlock approval with the exact captured id resolves ONLY when this
 *   window performed the unlock gesture (localGesture). On a foreign global
 *   unlock the approval is explicitly rejected so the dApp gets a definite
 *   401 rather than a stranded request or silent resume.
 */
export const routeNotificationAfterUnlock = async ({
  getApproval,
  resolveApproval,
  rejectApproval,
  replace,
  expectedApprovalId,
  localGesture = false,
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

  if (!localGesture) {
    // A different window authenticated the wallet. The Unlock approval this
    // window rendered was NOT consented here: reject it explicitly (the dApp
    // can retry now that the wallet is unlocked) instead of resolving on a
    // broadcast it never earned.
    if (rejectApproval) {
      await rejectApproval(
        'Wallet was unlocked in another window; please retry the request.',
        false,
        false,
        approvalId
      );
    }
    replace('/');
    return;
  }

  await resolveApproval(undefined, false, false, approvalId);
};
