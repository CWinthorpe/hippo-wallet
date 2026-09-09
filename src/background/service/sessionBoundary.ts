import notificationService from './notification';
import permissionService from './permission';
import preferenceService, { Account } from './preference';
import remoteDataPolicyService from './remoteDataPolicy';

type SiteAccountSnapshot = {
  origin: string;
  account?: Account | null;
};

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

const sameSiteAccount = (a: SiteAccountSnapshot, b: SiteAccountSnapshot) =>
  a.origin === b.origin && sameAccount(a.account, b.account);

/**
 * Revoke origin-scoped authority for every site whose account changes in a
 * bulk snapshot. Ordering-only writes are harmless; account replacement,
 * clearing, and removal are authority transitions and must invalidate both
 * pending and already-resolved approvals before persistence.
 */
export const revokeSiteAccountBoundaries = (
  previousSites: SiteAccountSnapshot[],
  nextSites: SiteAccountSnapshot[]
): string[] => {
  const previousByOrigin = new Map(
    previousSites.map((site) => [site.origin, site])
  );
  const nextByOrigin = new Map(nextSites.map((site) => [site.origin, site]));
  const changedOrigins = [
    ...new Set([...previousByOrigin.keys(), ...nextByOrigin.keys()]),
  ].filter((origin) => {
    const previous = previousByOrigin.get(origin) || { origin };
    const next = nextByOrigin.get(origin) || { origin };
    return !sameSiteAccount(previous, next);
  });

  changedOrigins.forEach((origin) => {
    notificationService.rejectApprovalsByOrigin(origin);
    notificationService.bumpOriginApprovalEpoch(origin);
  });
  return changedOrigins;
};

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

export const resetCurrentCoboSafeAccountWithBoundary = async () => {
  const account = await preferenceService.resetCurrentCoboSafeAddress();
  setCurrentAccountWithBoundary(account);
  return account;
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
