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

  test('wallet lock, account switch, reset, and re-onboarding bump the global epoch unconditionally', () => {
    const changeAccount = fieldBody(
      walletSrc,
      'changeAccount',
      '\n  authorizeLedgerHIDPermission'
    );
    // No conditional: the epoch must bump even when no approval is current,
    // because a resolved-but-unexecuted request is the target.
    expect(changeAccount).toContain('bumpApprovalEpoch()');
    expect(changeAccount).not.toMatch(
      /if \(notificationService\.currentApproval\)/
    );
    const lock = fieldBody(walletSrc, 'lockWallet', '\n  setAutoLockTime');
    expect(lock).toContain('bumpApprovalEpoch()');
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

  test('dashboard setSite chain change bumps the origin epoch', () => {
    const body = fieldBody(walletSrc, 'setSite', '\n  setSiteAccount');
    expect(body).toContain('bumpOriginApprovalEpoch(data.origin)');
    // Only on an actual chain change, so routine metadata writes are not
    // blanket rejections.
    expect(body).toMatch(/previousChain !== data\.chain/);
  });

  test('both chain-switch RPC paths bump the origin epoch', () => {
    const addChain = controllerSrc.slice(
      controllerSrc.indexOf('walletAddEthereumChain ='),
      controllerSrc.indexOf('walletSwitchEthereumChain =')
    );
    const switchChain = controllerSrc.slice(
      controllerSrc.indexOf('walletSwitchEthereumChain ='),
      controllerSrc.indexOf("@Reflect.metadata('APPROVAL', [\n    'AddAsset'")
    );
    expect(addChain).toContain('bumpOriginApprovalEpoch(origin)');
    expect(switchChain).toContain('bumpOriginApprovalEpoch(origin)');
  });
});
