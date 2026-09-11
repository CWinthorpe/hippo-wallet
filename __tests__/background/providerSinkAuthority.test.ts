/**
 * @jest-environment node
 */
// gpt56 round-10 blocker 2 sink-wiring regressor (round-11 shape):
// - provider signing sinks REQUIRE a capability (gesture-minted internal or
//   rpcFlow approval-captured dApp); they never mint authority on a caller's
//   behalf;
// - the internal mint API binds the BACKGROUND live account and the exact
//   request digest;
// - the four irreversible Gnosis effect sinks plus signTypedDataInternal all
//   treat the capability as mandatory and revalidate adjacent to the effect;
// - assertSigningApprovalResult keeps demanding __approvalId/__approvalComponent
//   for approval-bound (dApp) contexts.
// Paired behavioral coverage: authorityContextRevalidation.test.ts (real
// assert primitive), signHandshakeIntegration.test.ts (real service queue),
// wcInitAck.test.ts (connector lifecycle).

import fs from 'fs';
import path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');

const controller = stripComments(
  read('src/background/controller/provider/controller.ts')
);

describe('provider controller sink contract (round-11, blocker 2)', () => {
  test('sinks require a capability and NEVER mint internally', () => {
    const at = controller.indexOf('const requireRequestAuthorityContext');
    expect(at).toBeGreaterThanOrEqual(0);
    const body = controller.slice(at, controller.indexOf('const convertToHex'));
    expect(body).toContain('if (!context || !context.operationId');
    expect(body).toContain('Missing signing authority context');
    expect(body).toContain('Signing authority origin mismatch');
    expect(body).toContain(
      'Internal signing capability used for a dApp request'
    );
    expect(body).toContain('Signing capability does not match this request');
    // No minting happens at the sink anymore.
    expect(body).not.toContain('captureInternalAuthorityContext');
    expect(controller).not.toContain('ensureRequestAuthorityContext');
  });

  test('every signing sink entry requires the capability before the asserts', () => {
    const handlers = [
      'ethSendTransaction = async (options',
      'personalSign = async (req',
      'ethSignTypedDataV1 = async (req',
      'ethSignTypedDataV3 = async (req',
      'ethSignTypedDataV4 = async (req',
    ];
    for (const h of handlers) {
      const at = controller.indexOf(h);
      expect(at).toBeGreaterThanOrEqual(0);
      const seg = controller.slice(at, at + 2600);
      const requireAt = seg.indexOf('requireRequestAuthorityContext(');
      const assertResult = seg.indexOf('assertSigningApprovalResult(');
      const assertCtx = seg.indexOf('assertAuthorityContextStillValid(');
      expect(requireAt).toBeGreaterThanOrEqual(0);
      expect(assertResult).toBeGreaterThan(requireAt);
      expect(assertCtx).toBeGreaterThan(requireAt);
    }
  });

  test('assertSigningApprovalResult keeps the approval binding for dApp contexts', () => {
    const at = controller.indexOf('const assertSigningApprovalResult');
    const body = controller.slice(
      at,
      controller.indexOf('const requireRequestAuthorityContext')
    );
    expect(body).toContain('authorityContext.approvalBound !== false');
    expect(body).toContain('__approvalId');
    expect(body).toContain(
      '__approvalComponent !== authorityContext.approvalComponent'
    );
    expect(body).toContain('Signing approval result is missing');
  });
});

describe('gesture-minted internal capability (round-11, blocker 2)', () => {
  test('mint API binds the BACKGROUND live account, never the caller argument', () => {
    const wallet = stripComments(read('src/background/controller/wallet.ts'));
    const mint = wallet.slice(
      wallet.indexOf('mintInternalSigningCapability = async ('),
      wallet.indexOf('ethSendTransaction = async (')
    );
    expect(mint).toContain('captureInternalAuthorityContext');
    expect(mint).toContain('preferenceService.getCurrentAccount()');
    // no caller-supplied account is adopted
    expect(mint).not.toMatch(/boundAccount:\s*req\.account/);
    // digest binds the exact request payload and component
    expect(mint).toContain('computeRequestDigest(');
    expect(mint).toContain('request.data.params');
    // locked wallet cannot mint
    expect(mint).toContain('isUnlocked');
    expect(mint).toContain('No active account; confirm again.');
  });

  test('sessionBoundary primitive supports both token kinds', () => {
    const boundary = stripComments(
      read('src/background/service/sessionBoundary.ts')
    );
    const mint = boundary.slice(
      boundary.indexOf('export const captureInternalAuthorityContext'),
      boundary.indexOf('export const computeRequestDigest')
    );
    expect(mint).toContain('internalOrigin: true');
    expect(mint).toContain('approvalBound: false');
    expect(boundary).toContain('export const computeRequestDigest');
  });

  test('UI popup flows mint at confirmation and thread the capability into the sink', () => {
    const sendTx = stripComments(read('src/ui/utils/sendTransaction.ts'));
    expect(
      (sendTx.match(/mintInternalSigningCapability\(/g) || []).length
    ).toBeGreaterThanOrEqual(2);
    expect(
      (sendTx.match(/authorityContext: capability/g) || []).length
    ).toBeGreaterThanOrEqual(2);

    const sendPersonal = stripComments(
      read('src/ui/utils/sendPersonalMessage.ts')
    );
    expect(sendPersonal).toContain('mintInternalSigningCapability(');
    expect(sendPersonal).toContain('authorityContext: capability');

    const sendTyped = stripComments(read('src/ui/utils/sendTypedData.ts'));
    expect(sendTyped).toContain('mintInternalSigningCapability(');

    const signTx = stripComments(
      read('src/ui/views/Approval/components/SignTx.tsx')
    );
    expect(signTx).toContain('mintInternalSigningCapability(');
  });

  test('signTypedDataInternal treats the capability as mandatory and revalidates both sides of keyring', () => {
    const wallet = stripComments(read('src/background/controller/wallet.ts'));
    const body = wallet.slice(
      wallet.indexOf('signTypedDataInternal = async ('),
      wallet.indexOf('decryptMessage = async (')
    );
    expect(body).toContain('Missing signing authority context');
    expect(body).toContain('isUnlocked');
    // assert before AND after the keyring call
    expect(
      body.match(/assertAuthorityContextStillValid\(authorityContext\)/g)!
        .length
    ).toBeGreaterThanOrEqual(2);
    expect(body.indexOf('assertAuthorityContextStillValid')).toBeLessThan(
      body.indexOf('keyringService.getKeyringForAccount')
    );
    expect(
      body.lastIndexOf('assertAuthorityContextStillValid')
    ).toBeGreaterThan(body.indexOf('keyringService.signTypedMessage'));
    // still emits no UI completion broadcast (blocker 4 separation preserved)
    expect(body).not.toContain('SIGN_FINISHED');
    expect(body).not.toContain('broadcastToUI');
  });

  test('the four irreversible Gnosis effect sinks require and revalidate the capability', () => {
    const wallet = stripComments(read('src/background/controller/wallet.ts'));
    const sinks = [
      ['gnosisAddConfirmation = async (', 'keyring.addConfirmation'],
      ['gnosisAddSignature = async (', 'keyring.addSignature'],
      ['postGnosisTransaction = (', 'keyring.postTransaction'],
      ['handleGnosisMessage = async (', 'addGnosisMessage'],
    ] as const;
    for (const [head, effect] of sinks) {
      const at = wallet.indexOf(head);
      expect(at).toBeGreaterThanOrEqual(0);
      const body = wallet.slice(at, at + 900);
      expect(body).toContain('Missing signing authority context');
      expect(body).toContain('assertAuthorityContextStillValid');
      expect(body.indexOf('assertAuthorityContextStillValid')).toBeLessThan(
        body.indexOf(effect)
      );
    }
  });

  test('MiniSign typed-data batch carries an abortable operation generation', () => {
    const mgr = stripComments(
      read('src/ui/component/MiniSignV2/state/TypedDataSignatureManager.ts')
    );
    expect(mgr).toContain('operationToken');
    expect(mgr).toContain(
      'const aborted = () => operationId !== this.operationToken'
    );
    // checked before signing each item and before resolving the batch
    const loop = mgr.slice(
      mgr.indexOf('private async runSigningFlow'),
      mgr.indexOf('public resolve(')
    );
    expect(
      (loop.match(/if \(aborted\(\)\)/g) || []).length
    ).toBeGreaterThanOrEqual(3);
    expect(mgr).toContain('const operationId = ++this.operationToken;');
    // reset (close/reject path) revokes the generation
    const reset = mgr.slice(
      mgr.indexOf('private reset()'),
      mgr.indexOf('private reset()') + 400
    );
    expect(reset).toContain('this.operationToken += 1;');
  });

  test('minted-token origin confinement is enforced at the require gate', () => {
    // Source contract: the sink require-gate rejects a non-internal origin
    // for approvalBound:false contexts and rejects origin mismatches.
    expect(controller).toContain('context.origin !== origin');
    expect(controller).toContain(
      "'Internal signing capability used for a dApp request.'"
    );
  });
});
