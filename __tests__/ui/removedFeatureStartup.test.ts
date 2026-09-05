import fs from 'fs';
import path from 'path';

const readSource = (relativePath: string) =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');

describe('removed feature model initialization', () => {
  test('the legacy rematch model layer is fully removed', () => {
    expect(fs.existsSync('src/ui/models')).toBe(false);
  });

  test('business store bootstrap initializes only the retained stores', () => {
    const bootstrapStores = readSource('src/ui/state/initializeBizStores.ts');
    for (const removedStore of [
      'initializeBridgeStore',
      'initializeGasAccountStore',
      'initializePerpsStore',
      'initializeGiftStore',
      'gift',
      'perps',
      'gasAccount',
      'bridge',
    ]) {
      expect(bootstrapStores).not.toContain(removedStore);
    }
    expect(bootstrapStores).toContain('initializePreferenceStore');
    expect(bootstrapStores).toContain('initializeContactBookStore');
  });

  test('app startup bootstraps no business stores before the privacy gate', () => {
    const bootstrap = readSource('src/ui/app.tsx');
    expect(bootstrap).not.toContain('initializeBizStores()');
    expect(bootstrap).not.toContain('initializeExchangeStore()');
    expect(bootstrap).not.toContain('initializeChainsStore()');
  });

  test('business stores initialize only after the privacy policy is configured', () => {
    const gate = readSource('src/ui/views/RemoteDataPolicy/index.tsx');
    expect(gate).toContain('if (!policy?.configured) return');
    expect(gate).toContain('initializeBizStores()');
    expect(gate).toContain('initializeExchangeStore()');
    expect(gate).toContain('initializeChainsStore()');
  });
});
