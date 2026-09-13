import fs from 'fs';
import path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('Hippo pins approval payment method to native', () => {
  test('display resolvers force native and hide the payment tabs', () => {
    const display = read(
      'src/ui/views/Approval/components/TxComponents/GasSelector/approvalGasDisplay.ts'
    );
    expect(display).toContain(
      "export const HIPPO_GAS_METHOD_TABS_HIDDEN = true"
    );
    expect(display).toContain(
      "const HIPPO_FORCED_GAS_METHOD = 'native' as const"
    );
    // The resolver body must be exactly the forced return (no branch can
    // yield 'gasAccount').
    const resolver = display.slice(display.indexOf('export const resolveApprovalGasMethod'));
    const body = resolver.slice(0, resolver.indexOf('};'));
    expect(body).toContain('return HIPPO_FORCED_GAS_METHOD;');
    expect(body).not.toMatch(/return\s+'gasAccount'|\?\s*'gasAccount'/);
  });

  test('gas-method selectors are gated on the compile-time hidden constant', () => {
    for (const file of [
      'src/ui/views/Approval/components/TxComponents/GasSelector/SignMainnetGasSelectorHeader.tsx',
      'src/ui/views/Approval/components/TxComponents/GasSelector/SignMainnetShowMoreGasModal.tsx',
      'src/ui/views/Approval/components/TxComponents/GasSelectorHeader.tsx',
    ]) {
      expect(read(file)).toContain('HIPPO_GAS_METHOD_TABS_HIDDEN');
    }
  });

  test('no approval setter can select the removed gasAccount method', () => {
    const signTx = read('src/ui/views/Approval/components/SignTx.tsx');
    const mini = read(
      'src/ui/views/Approval/components/MiniSignTx/MiniSignTxV2.tsx'
    );
    // The only 'gasAccount' literals remaining in these files are the
    // removed-surface flow guards (isGasAccountTopUpFlow checks), never a
    // setGasMethod/setManualGasMethod argument.
    for (const source of [signTx, mini]) {
      const offenders = source.match(
        /set(GasMethod|ManualGasMethod)\(\s*'gasAccount'/g
      );
      expect(offenders).toBeNull();
      const proxyOffenders = source.match(
        /\.setGasMethod\(\s*method\b/g
      );
      expect(proxyOffenders).toBeNull();
    }
  });

  test('broadcast rejects any sponsored/gasless approval result', () => {
    const provider = read(
      'src/background/controller/provider/controller.ts'
    );
    expect(provider).toContain(
      'Gasless, sponsored, and Gas Account transactions are not supported'
    );
  });
});
