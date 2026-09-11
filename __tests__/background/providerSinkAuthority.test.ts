/**
 * @jest-environment node
 */
// gpt56 round-9 blocker 2 sink-wiring regressor:
// - every signing sink entry mints an internal capability BEFORE the
//   approval/authority asserts, and the mint is restricted to internal
//   origins; an external request without an approval-captured context still
//   fails closed with zero sink execution.
// - assertSigningApprovalResult keeps demanding __approvalId /
//   __approvalComponent for approval-bound (dApp) contexts only.
// Source contracts are paired with behavioral coverage in
// authorityContextRevalidation.test.ts (real assert primitive) and
// signHandshakeIntegration.test.ts (real service queue).

import fs from 'fs';
import path from 'path';

const controllerSource = fs.readFileSync(
  path.join(process.cwd(), 'src/background/controller/provider/controller.ts'),
  'utf8'
);

const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');

const src = stripComments(controllerSource);

describe('provider controller sink contract (round-9 blocker 2)', () => {
  test('ensureRequestAuthorityContext: reuse-or-mint-internal-or-reject', () => {
    const at = src.indexOf('const ensureRequestAuthorityContext');
    expect(at).toBeGreaterThanOrEqual(0);
    const body = src.slice(at, src.indexOf('const convertToHex'));
    // pre-existing approval-captured context is never overwritten
    expect(body).toContain(
      'if (req.authorityContext) return req.authorityContext;'
    );
    // minting is gated to internal origins
    expect(body).toContain('permissionService.isInternalOrigin(origin)');
    // external without context fails closed with a user-rejected error
    expect(body).toContain('throw ethErrors.provider.userRejectedRequest');
    expect(body).toContain('captureInternalAuthorityContext');
    // no silent fallthrough: the reject branch must throw, not return
    expect(body).not.toMatch(
      /if \(!origin \|\| !permissionService\.isInternalOrigin\(origin\)\) \{\s*return/
    );
  });

  test('every signing sink entry mints before the asserts', () => {
    const handlers = [
      'ethSendTransaction = async (options',
      'personalSign = async (req',
      'ethSignTypedDataV1 = async (req',
      'ethSignTypedDataV3 = async (req)',
      'ethSignTypedDataV4 = async (req)',
    ].map((h) => h.replace(')', ''));
    for (const h of handlers) {
      const at = src.indexOf(h);
      expect(at).toBeGreaterThanOrEqual(0);
      const seg = src.slice(at, at + 2400);
      const mint = seg.indexOf('ensureRequestAuthorityContext(');
      const assertResult = seg.indexOf('assertSigningApprovalResult(');
      const assertCtx = seg.indexOf('assertAuthorityContextStillValid(');
      expect(mint).toBeGreaterThanOrEqual(0);
      expect(assertResult).toBeGreaterThan(mint);
      expect(assertCtx).toBeGreaterThan(mint);
    }
  });

  test('assertSigningApprovalResult keeps the approval binding for dApp contexts', () => {
    const at = src.indexOf('const assertSigningApprovalResult');
    const body = src.slice(
      at,
      src.indexOf('const ensureRequestAuthorityContext')
    );
    expect(body).toContain('authorityContext.approvalBound !== false');
    expect(body).toContain('__approvalId');
    expect(body).toContain(
      '__approvalComponent !== authorityContext.approvalComponent'
    );
    // missing result still hard-rejects for every caller
    expect(body).toContain('Signing approval result is missing');
  });

  test('internal capability is non-approval-bound with internal origin fixed true', () => {
    const boundary = stripComments(
      fs.readFileSync(
        path.join(process.cwd(), 'src/background/service/sessionBoundary.ts'),
        'utf8'
      )
    );
    const mint = boundary.slice(
      boundary.indexOf('export const captureInternalAuthorityContext'),
      boundary.indexOf('const rejectAuthority')
    );
    expect(mint).toContain('internalOrigin: true');
    expect(mint).toContain('approvalBound: false');
    expect(mint).toContain('crypto.randomUUID()');
  });

  test('WalletController popup forwarders keep their existing signatures (UI callers unmodified)', () => {
    const wallet = stripComments(
      fs.readFileSync(
        path.join(process.cwd(), 'src/background/controller/wallet.ts'),
        'utf8'
      )
    );
    // sendTransaction.ts / sendPersonalMessage.ts call these with no context;
    // the sink mints internally, so the forwarders must remain pass-through.
    expect(wallet).toMatch(
      /ethSendTransaction = async \(\s*\.\.\.args: Parameters<typeof providerController\.ethSendTransaction>/
    );
    expect(wallet).toMatch(
      /ethPersonalSign = async \(\s*\.\.\.args: Parameters<typeof providerController\.personalSign>/
    );
    expect(wallet).toMatch(
      /ethSignTypedDataV4 = async \(\s*\.\.\.args: Parameters<typeof providerController\.ethSignTypedDataV4>/
    );
  });
});
