import notificationService from './notification';
import permissionService from './permission';
import preferenceService, { Account } from './preference';
import remoteDataPolicyService from './remoteDataPolicy';

const sameAccount = (
  a: Account | undefined | null,
  b: Account | undefined | null
) =>
  a?.address?.toLowerCase() === b?.address?.toLowerCase() &&
  a?.type === b?.type &&
  a?.brandName === b?.brandName;

const accountMatchesBoundaryTarget = (
  account: Account | undefined | null,
  address: string,
  type: string,
  brand?: string
) =>
  !!account &&
  account.address.toLowerCase() === address.toLowerCase() &&
  account.type === type &&
  (brand === undefined || account.brandName === brand);

/**
 * Set the effective wallet account as one synchronous authority boundary.
 * The invalidation happens before the identity write and has no await between
 * revocation and persistence, so resolved-but-unexecuted continuations cannot
 * observe a new account while retaining old approval authority.
 */
export const setCurrentAccountWithBoundary = (account: Account | null) => {
  const previous = preferenceService.getCurrentAccount();
  if (!sameAccount(previous, account)) {
    notificationService.rejectAllApprovals();
    notificationService.clear();
    notificationService.bumpApprovalEpoch();
  }
  preferenceService.setCurrentAccount(account);
};

/**
 * Revoke authority synchronously before an account is hidden or removed.
 * Missing hardware-wallet brand metadata is an intentional address+type
 * match; a supplied brand remains an exact identity check.
 */
export const revokeAccountBoundaryIfAffected = (
  address: string,
  type: string,
  brand?: string
): boolean => {
  const affectsCurrent = accountMatchesBoundaryTarget(
    preferenceService.getCurrentAccount(),
    address,
    type,
    brand
  );
  const affectsSite = permissionService
    .getSites()
    .some((site) =>
      accountMatchesBoundaryTarget(site.account, address, type, brand)
    );
  if (!affectsCurrent && !affectsSite) {
    return false;
  }
  notificationService.rejectAllApprovals();
  notificationService.clear();
  notificationService.bumpApprovalEpoch();
  return true;
};

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
