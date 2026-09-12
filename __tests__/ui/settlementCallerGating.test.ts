/**
 * @jest-environment node
 */
// gpt56 round-12 blocker 2: backend guard failures must never be presented
// as successful UI actions. Every waiting-component completion path closes
// its popup ONLY when the background settlement hook returned TRUE (the
// boolean contract from #4083 + Hippo's mandatory guard). This is the
// caller-level contract the hook tests (useApprovalBinding) cannot cover:
// they prove the hook suppresses ITS navigation; these prove the CALLERS
// consume the returned boolean before destroying/closing display.

import fs from 'fs';
import path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');

const waitingFiles = [
  'src/ui/views/Approval/components/CommonWaiting.tsx',
  'src/ui/views/Approval/components/PrivatekeyWaiting.tsx',
  'src/ui/views/Approval/components/LedgerHardwareWaiting.tsx',
  'src/ui/views/Approval/components/ImKeyHardwareWaiting.tsx',
  'src/ui/views/Approval/components/QRHardWareWaiting/QRHardWareWaiting.tsx',
  'src/ui/views/Approval/components/CoinbaseWaiting/index.tsx',
  'src/ui/views/Approval/components/WatchAddressWaiting/index.tsx',
];

describe('waiting-component settlement gating (round-12 blocker 2)', () => {
  test.each(waitingFiles)(
    '%s closes its success popup only on a proven settlement',
    (file) => {
      const src = stripComments(read(file));
      // the effect body: signFinishedData && isClickDone branch
      const branchAt = src.indexOf('if (signFinishedData && isClickDone)');
      expect(branchAt).toBeGreaterThanOrEqual(0);
      const branch = src.slice(
        branchAt,
        src.indexOf('}, [signFinishedData, isClickDone]', branchAt)
      );
      // NO unconditional closePopup in the branch: the only closePopup call
      // sits inside the settled-true callback.
      const closeAt = branch.indexOf('closePopup()');
      const resolveAt = branch.indexOf('resolveApproval(');
      expect(resolveAt).toBeGreaterThanOrEqual(0);
      expect(closeAt).toBeGreaterThan(resolveAt);
      const thenAt = branch.indexOf('.then((settled) =>');
      expect(thenAt).toBeGreaterThan(-1);
      expect(thenAt).toBeLessThan(closeAt);
      expect(branch.slice(thenAt, closeAt)).toContain('if (settled)');
    }
  );

  test('SignText destroys the prepared-signature modal only on a proven settlement', () => {
    const src = stripComments(
      read('src/ui/views/Approval/components/SignText.tsx')
    );
    const at = src.indexOf('void resolveApproval(');
    expect(at).toBeGreaterThanOrEqual(0);
    const region = src.slice(
      at,
      src.indexOf('}}', src.indexOf('.then((settled) =>', at))
    );
    expect(region).toContain('.then((settled) =>');
    expect(region).toContain('if (settled) modal.destroy()');
    // and NOT the pre-fix shape (destroy before/at the resolve call)
    const before = src.slice(at, src.indexOf('.then((settled)', at));
    expect(before).not.toContain('modal.destroy()');
  });

  // gpt56 round-12 blocker 1 (wiring half): the approval window must hand
  // children the parent-rendered tuple synchronously.
  test('the approval window provides the rendered identity via context', () => {
    const src = stripComments(read('src/ui/views/Approval/index.tsx'));
    expect(src).toContain('RenderedApprovalIdentityContext.Provider');
    expect(src).toContain(
      'const renderedIdentity: RenderedApprovalIdentity = {'
    );
    // the tuple comes from the rendered approval object itself
    const region = src.slice(
      src.indexOf('const renderedIdentity'),
      src.indexOf('RenderedApprovalIdentityContext.Provider')
    );
    expect(region).toContain('approvalId: approval.id');
    expect(region).toContain('approvalComponent');
    expect(region).toContain('bindSignEventFromApproval(approval)');
    // the component remounts per approval id (key) so identity never drifts
    expect(src).toContain('key={approval.id}');
  });

  test('hooks.ts settlement identity prefers the window context over the live capture', () => {
    const src = stripComments(read('src/ui/utils/hooks.ts'));
    expect(src).toContain('const windowIdentity = useContext(');
    const resolveRegion = src.slice(
      src.indexOf('const resolveApproval = async ('),
      src.indexOf('const rejectApproval = async (')
    );
    expect(resolveRegion).toContain('windowIdentity');
    expect(resolveRegion).toContain(
      'binding?.approvalId ?? windowIdentity.approvalId'
    );
    // the mount capture must be disabled inside the window
    const captureRegion = src.slice(
      src.indexOf('useEffect(() => {'),
      src.indexOf('const resolveApproval = async (')
    );
    expect(captureRegion).toContain('if (windowIdentity) return;');
    // getApprovalBinding in-window path uses the immutable operation tuple
    const bindingRegion = src.slice(
      src.indexOf('const getApprovalBinding = ('),
      src.indexOf('return [')
    );
    expect(bindingRegion).toContain('windowIdentity.operationBinding');
  });

  test('approvalResolution consumes both settlement booleans', () => {
    const src = stripComments(read('src/ui/views/Unlock/approvalResolution.ts'));
    // foreign-unlock branch: navigate only when the reject settled
    const rejectBranch = src.slice(
      src.indexOf('if (!localGesture)'),
      src.indexOf('const settled = await resolveApproval')
    );
    expect(rejectBranch).toContain('const rejected = await rejectApproval');
    expect(rejectBranch).toContain('if (!rejected)');
    // local branch: only success may fall through to navigation
    expect(src).toContain('const settled = await resolveApproval');
    expect(src).toContain('if (!settled) return;');
  });
});
