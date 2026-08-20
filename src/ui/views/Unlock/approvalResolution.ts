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
}

/**
 * Route a notification window after authentication without treating the
 * unlock gesture as consent for an unrelated pending request.
 */
export const routeNotificationAfterUnlock = async ({
  getApproval,
  resolveApproval,
  replace,
}: RouteNotificationAfterUnlockOptions) => {
  const approval = await getApproval();
  if (!approval) {
    replace('/');
    return;
  }

  const isUnlockApproval =
    String(approval.data?.approvalComponent) === 'Unlock';
  const approvalId = approval.id;

  if (!isUnlockApproval || typeof approvalId !== 'string' || !approvalId) {
    replace('/approval');
    return;
  }

  await resolveApproval(undefined, false, false, approvalId);
};
