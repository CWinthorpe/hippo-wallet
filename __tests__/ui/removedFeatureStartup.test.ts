import fs from 'fs';
import path from 'path';

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('removed feature store initialization', () => {
  test('biz store initialization skips removed feature stores', () => {
    const bootstrap = readSource('src/ui/state/initializeBizStores.ts');
    for (const removed of [
      'initializeBridgeStore',
      'initializeGasAccountStore',
      'initializePerpsStore',
      'initializeGiftStore',
    ]) {
      expect(bootstrap).not.toContain(removed);
    }
  });

  test('business stores initialize only after the privacy policy is configured', () => {
    const app = readSource('src/ui/app.tsx');
    const gate = readSource('src/ui/views/RemoteDataPolicy/index.tsx');
    expect(app).not.toContain('initializeBizStores');
    expect(app).not.toContain('initializeExchangeStore');
    expect(app).not.toContain('initializeChainsStore');
    expect(gate).toContain('if (!policy?.configured) return');
    expect(gate).toContain('void initializeBizStores()');
    expect(gate).toContain('void initializeExchangeStore()');
    expect(gate).toContain('void initializeChainsStore()');
  });
});
