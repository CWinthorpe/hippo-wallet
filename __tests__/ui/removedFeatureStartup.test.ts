import fs from 'fs';
import path from 'path';

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('removed feature model initialization', () => {
  test('app startup initializes only models that still exist', () => {
    const app = readSource('src/ui/models/app.ts');
    for (const removedDispatch of [
      'dispatch.swap.',
      'dispatch.bridge.',
      'dispatch.gasAccount.',
      'dispatch.perps.',
    ]) {
      expect(app).not.toContain(removedDispatch);
    }
  });

  test('account startup no longer initializes promotional gift state', () => {
    const account = readSource('src/ui/models/account.ts');
    expect(account).not.toContain('dispatch.gift.');
    expect(account).not.toContain('initGiftStateAsync');
  });

  test('business models initialize only after the privacy policy is configured', () => {
    const bootstrap = readSource('src/ui/app.tsx');
    const gate = readSource('src/ui/views/RemoteDataPolicy/index.tsx');
    expect(bootstrap).not.toContain('store.dispatch.app.initBizStore()');
    expect(gate).toContain('if (!policy?.configured) return');
    expect(gate).toContain('dispatch.app.initBizStore()');
    const appModel = readSource('src/ui/models/app.ts');
    expect(appModel).not.toContain('dispatch.currency.init()');
    expect(appModel).not.toContain('dispatch.exchange.init()');
  });
});
