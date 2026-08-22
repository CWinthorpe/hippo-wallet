import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('testnet chain logos are bundled, not fetched at startup', () => {
  test('customTestnet no longer performs the unclassified DeBank logos fetch', () => {
    const source = read('src/background/service/customTestnet.ts');
    expect(source).not.toContain(
      'static.debank.com/supported_testnet_chains.json'
    );
    expect(source).toContain('supportedTestnetChainLogos');
  });

  test('the bundled logos snapshot is non-empty and valid', () => {
    const bundled = JSON.parse(
      read('src/background/service/data/supported_testnet_chains.json')
    ) as Record<string, { chain_logo_url?: string }>;
    expect(Object.keys(bundled).length).toBeGreaterThan(0);
    const first = Object.values(bundled)[0];
    expect(typeof first?.chain_logo_url).toBe('string');
    expect(first.chain_logo_url).toMatch(/^https:\/\//);
  });
});
