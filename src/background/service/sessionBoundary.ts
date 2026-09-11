import { ethErrors } from 'eth-rpc-errors';
import notificationService from './notification';
import permissionService, { ConnectedSite } from './permission';
import preferenceService, { Account } from './preference';
import remoteDataPolicyService from './remoteDataPolicy';

type SiteAuthoritySnapshot = {
  origin: string;
  account?: Account | null;
  chain?: ConnectedSite['chain'];
  isConnected?: boolean;
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

const sameSiteAuthority = (
  a: SiteAuthoritySnapshot,
  b: SiteAuthoritySnapshot
) =>
  a.origin === b.origin &&
  sameAccount(a.account, b.account) &&
  a.chain === b.chain &&
  a.isConnected === b.isConnected;

/**
 * Revoke origin-scoped authority for every site whose account, chain, or
 * connection state changes in a bulk snapshot. Ordering-only writes are
 * harmless; authority transitions invalidate pending and already-resolved
 * approvals before persistence.
 */
export const revokeSiteAccountBoundaries = (
  previousSites: SiteAuthoritySnapshot[],
  nextSites: SiteAuthoritySnapshot[]
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
    return !sameSiteAuthority(previous, next);
  });

  changedOrigins.forEach((origin) => {
    notificationService.rejectApprovalsByOrigin(origin);
    notificationService.bumpOriginApprovalEpoch(origin);
  });
  return changedOrigins;
};

// Install the callback after both services have been constructed. This avoids
// a permission -> notification -> permission module cycle while making every
// permission mutation boundary-aware, including callers outside WalletController.
permissionService.setAuthorityBoundary?.(revokeSiteAccountBoundaries);

export type AuthorityContext = {
  approvalEpoch: number;
  originEpoch: number;
  operationId: string;
  requestDigest: string;
  origin: string;
  approvalComponent: string;
  boundAccount: {
    address: string;
    type?: string;
    brandName?: string;
  } | null;
  boundChain?: string;
  internalOrigin: boolean;
};

export const captureAuthorityContext = ({
  origin,
  boundAccount,
  boundChain,
  internalOrigin,
  operationId,
  requestDigest,
  approvalComponent,
}: {
  origin: string;
  boundAccount: Account | null;
  boundChain?: string;
  internalOrigin: boolean;
  operationId: string;
  requestDigest: string;
  approvalComponent: string;
}): AuthorityContext => ({
  approvalEpoch: notificationService.approvalEpoch ?? 0,
  originEpoch: notificationService.getOriginApprovalEpoch?.(origin) ?? 0,
  operationId,
  requestDigest,
  origin,
  approvalComponent,
  boundAccount: boundAccount
    ? {
        address: boundAccount.address.toLowerCase(),
        type: boundAccount.type,
        brandName: boundAccount.brandName,
      }
    : null,
  boundChain,
  internalOrigin,
});
const rejectAuthority = (message: string): never => {
  throw ethErrors.provider.userRejectedRequest({ message });
};

/**
 * Revalidate the authority token immediately adjacent to a privileged sink.
 * This is intentionally independent of rpcFlow so an async keyring, hardware,
 * or RPC operation cannot outlive the boundary checks at handler entry.
 */
export const assertAuthorityContextStillValid = (
  context: AuthorityContext,
  currentAccount?: Account | null
) => {
  if (
    !context ||
    !Number.isInteger(context.approvalEpoch) ||
    !context.operationId ||
    !context.requestDigest
  ) {
    rejectAuthority('Missing signing authority context; approve again.');
  }
  if (!preferenceService.getCurrentAccount() && !currentAccount) {
    rejectAuthority('No active account; approve again.');
  }
  if (
    notificationService.approvalEpoch !== context.approvalEpoch ||
    notificationService.getOriginApprovalEpoch(context.origin) !==
      context.originEpoch
  ) {
    rejectAuthority('Session context changed; approve again.');
  }
  if (
    !context.internalOrigin &&
    !permissionService.hasPermission(context.origin)
  ) {
    rejectAuthority('Connection for this site was revoked; approve again.');
  }

  if (context.boundAccount) {
    const site = permissionService.getConnectedSite(context.origin);
    const liveAccount = context.internalOrigin
      ? currentAccount || preferenceService.getCurrentAccount()
      : preferenceService.getPreference('isEnabledDappAccount') && site
      ? site.account || preferenceService.getCurrentAccount()
      : preferenceService.getCurrentAccount();
    if (
      !liveAccount ||
      liveAccount.address.toLowerCase() !== context.boundAccount.address ||
      liveAccount.type !== context.boundAccount.type ||
      liveAccount.brandName !== context.boundAccount.brandName
    ) {
      rejectAuthority('Active account changed; approve again.');
    }
  }

  if (context.boundChain) {
    const liveChain = permissionService.getConnectedSite(context.origin)?.chain;
    if (liveChain !== context.boundChain) {
      rejectAuthority('Active chain changed; approve again.');
    }
  }
};

/**
 * Set the effective wallet account as one synchronous boundary. The
 * invalidation happens before the identity write and has no await between
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
