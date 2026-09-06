import notificationService from './notification';
import remoteDataPolicyService from './remoteDataPolicy';

/**
 * Revoke every approval and remote-data capability before a reset operation
 * crosses its first await. The returned promise covers asynchronous DNR
 * cleanup; the in-memory fail-closed state is changed synchronously by
 * `lock()` before it yields.
 */
export const revokeSessionBoundaryConsent = () => {
  notificationService.rejectAllApprovals();
  notificationService.clear();
  notificationService.bumpApprovalEpoch();
  return remoteDataPolicyService.lock();
};

/**
 * Run a destructive reset while keeping the session boundary active even when
 * keyring encryption is slow or stalled. This is deliberately generic so the
 * reset regression can exercise the exact ordering used by WalletController.
 */
export const runWithSessionBoundary = async <T>(
  operation: () => Promise<T>
): Promise<T> => {
  const boundaryPromise = revokeSessionBoundaryConsent();
  try {
    return await operation();
  } finally {
    await boundaryPromise;
  }
};
