/**
 * @jest-environment node
 */
// Boundary-glue regressors for B1: the trust-boundary entry points that must
// invalidate origin-scoped consent. Behaviour of the sink-side enforcement is
// covered by rpcFlowPostApprovalBoundaries.test.ts; these pin that the
// authority-transition sites actually invalidate per-origin consent, so the
// sink-adjacent recheck sees the transition.

import fs from 'fs';

const read = (p: string) => fs.readFileSync(p, 'utf8');

const walletSrc = read('src/background/controller/wallet.ts');
const controllerSrc = read('src/background/controller/provider/controller.ts');

/** Extract the body of a class-field arrow function by name. */
const fieldBody = (src: string, name: string, endMarker: string) => {
  const start = src.indexOf(`  ${name} =`);
  if (start === -1) throw new Error(`field ${name} not found`);
  const end = src.indexOf(endMarker, start);
  if (end === -1) throw new Error(`end of ${name} not found`);
  const body = src.slice(start, end);
  // Guard against accidental over-extension past the field itself.
  expect(body).not.toMatch(/\n {2}[a-zA-Z]+ = (?:\(|async|\w+Service\.)/);
  return body;
};

describe('B1 origin-authority transition wiring', () => {
  test('setSiteAccount rejects pending origin approvals and bumps the origin epoch', () => {
    const body = fieldBody(
      walletSrc,
      'setSiteAccount',
      '\n  updateSiteBasicInfo'
    );
    expect(body).toContain('rejectApprovalsByOrigin(origin)');
    expect(body).toContain('bumpOriginApprovalEpoch(origin)');
  });

  test('wallet lock and account switch use the global account/session boundaries', () => {
    const changeAccount = fieldBody(
      walletSrc,
      'changeAccount',
      '\n  authorizeLedgerHIDPermission'
    );
    expect(changeAccount).toContain('setCurrentAccountWithBoundary(account)');
    expect(changeAccount).not.toMatch(
      /if \(notificationService\.currentApproval\)/
    );
    const lock = fieldBody(walletSrc, 'lockWallet', '\n  setAutoLockTime');
    expect(lock).toContain('bumpApprovalEpoch()');
    const boundarySrc = read('src/background/service/sessionBoundary.ts');
    expect(boundarySrc).toContain('notificationService.bumpApprovalEpoch()');
  });

  test('background identity writes are centralized through the session boundary primitive', () => {
    const sources = [
      walletSrc,
      read('src/background/controller/base.ts'),
      read('src/background/controller/provider/controller.ts'),
      read('src/background/controller/provider/internalMethod.ts'),
      read('src/background/controller/provider/rpcFlow.ts'),
    ];
    for (const source of sources) {
      expect(source).not.toContain('preferenceService.setCurrentAccount(');
    }
    expect(read('src/background/service/sessionBoundary.ts')).toContain(
      'preferenceService.setCurrentAccount(account)'
    );
  });

  test('disconnect bumps the origin epoch', () => {
    const body = fieldBody(
      walletSrc,
      'removeConnectedSite',
      '\n  getSitesByDefaultChain'
    );
    expect(body).toContain('rejectApprovalsByOrigin(origin)');
    expect(body).toContain('bumpOriginApprovalEpoch(origin)');
  });

  test('dashboard setSite chain change crosses the authority boundary', () => {
    // gpt56 round-8 blocker 2: revocation is no longer per-caller. Every
    // persisted site write must route through a permissionService mutation
    // that synchronously invokes the installed boundary before persistence
    // (proved behaviourally in permissionAuthorityBoundary.test.ts).
    const body = fieldBody(walletSrc, 'setSite', '\n  setSiteAccount');
    expect(body).toContain('permissionService.setSite(data)');
    const permissionSrc = read('src/background/service/permission.ts');
    expect(permissionSrc).toMatch(
      /setSite = \(site: ConnectedSite\) => \{\s*if \(!this\.lruCache\) return;\s*this\.beforeAuthorityMutation\(this\._getSite\(site\.origin\), site\);\s*this\.lruCache\.set/
    );
    // Chain identity is part of the boundary comparison.
    const boundarySrc = read('src/background/service/sessionBoundary.ts');
    expect(boundarySrc).toContain('a.chain === b.chain');
  });

  test('both chain-switch RPC paths persist through the boundary-enforcing service primitive', () => {
    const addChain = controllerSrc.slice(
      controllerSrc.indexOf('walletAddEthereumChain ='),
      controllerSrc.indexOf('walletSwitchEthereumChain =')
    );
    const switchChain = controllerSrc.slice(
      controllerSrc.indexOf('walletSwitchEthereumChain ='),
      controllerSrc.indexOf("@Reflect.metadata('APPROVAL', [\n    'AddAsset'")
    );
    expect(addChain).toContain('permissionService.updateConnectSite');
    expect(switchChain).toContain('permissionService.updateConnectSite');
    // The service primitive itself must revoke before persisting.
    const permissionSrc = read('src/background/service/permission.ts');
    const update = permissionSrc.slice(
      permissionSrc.indexOf('updateConnectSite = ('),
      permissionSrc.indexOf('hasPermission = ')
    );
    const revokeAt = update.indexOf(
      'this.beforeAuthorityMutation(previous, next)'
    );
    const writeAt = update.indexOf('this.lruCache.set(origin, next)');
    expect(revokeAt).toBeGreaterThanOrEqual(0);
    expect(writeAt).toBeGreaterThan(revokeAt);
  });
});
