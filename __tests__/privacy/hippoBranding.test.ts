import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

const textFilesUnder = (relativeRoot: string, extensions: string[]) => {
  const output: string[] = [];
  const visit = (directory: string) => {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (extensions.includes(path.extname(entry.name))) {
        output.push(fs.readFileSync(absolutePath, 'utf8'));
      }
    });
  };
  visit(path.join(root, relativeRoot));
  return output.join('\n');
};

describe('Hippo Wallet branding invariants', () => {
  test('ships Hippo metadata in manifests, locales, and package metadata', () => {
    const packageJson = JSON.parse(read('package.json'));
    const manifest = JSON.parse(
      read('src/manifest/chrome-mv3/manifest.json')
    );
    const locale = JSON.parse(read('_raw/_locales/en/messages.json'));

    expect(packageJson.name).toBe('hippo-wallet');
    expect(packageJson.homepage).toBe(
      'https://github.com/CWinthorpe/hippo-wallet'
    );
    expect(manifest.author).toBe('Hippo Wallet contributors');
    expect(manifest.action.default_title).toBe('Hippo Wallet');
    expect(manifest.version_name).toBe('0.93.100-hippo.1');
    expect(manifest.homepage_url).toBe(
      'https://github.com/CWinthorpe/hippo-wallet'
    );
    expect(locale.appName.message).toBe('Hippo Wallet');
  });

  test('loads the Resupply-inspired typography without legacy font sheets', () => {
    const html = [
      'src/ui/popup.html',
      'src/ui/desktop.html',
      'src/ui/index.html',
      'src/ui/notification.html',
    ]
      .map(read)
      .join('\n');
    const fonts = read('_raw/css/HippoFonts.css');

    expect(html).toContain('/css/HippoFonts.css');
    expect(html).not.toContain('Roboto+Mono+Lato.css');
    expect(fonts).toContain("font-family: 'Pixel Operator'");
    expect(fonts).toContain("font-family: 'IBM Plex Mono'");
    expect(fs.existsSync(path.join(root, '_raw/fonts/PixelOperator.ttf'))).toBe(
      true
    );
    expect(
      fs.existsSync(path.join(root, '_raw/fonts/IBMPlexMono-Regular.ttf'))
    ).toBe(true);
  });

  test('uses the exact core brand palette and a dark default theme', () => {
    const theme = read('src/constant/theme-colors.js');
    const backgroundPreference = read(
      'src/background/service/preference.ts'
    );
    const mark = read('src/ui/assets/hippo-wallet-mark.svg');
    const onboarding = read('src/ui/views/NewUserImport/Guide.tsx');
    const popup = read('src/ui/popup.html');

    ['#111629', '#0372FF', '#26E99A', '#FFFFFF'].forEach(
      (color) => expect(mark).toContain(color)
    );
    expect(mark).not.toMatch(/linearGradient|radialGradient|filter=/);
    expect(theme).toContain("'blue-default': 'rgba(3, 114, 255, 1)'");
    expect(theme).toContain("'green-default': 'rgba(38, 233, 154, 1)'");
    expect(theme).toContain("'neutral-bg1': 'rgba(17, 22, 41, 1)'");
    expect(theme).toContain("'neutral-card1': 'rgba(38, 44, 64, 1)'");
    expect(backgroundPreference).toContain(
      'themeMode: DARK_MODE_TYPE.dark'
    );
    expect(onboarding).not.toContain("classList.remove('dark')");
    expect(popup).toContain("fill='%23111629'");
    expect(popup).toContain("fill='%23262C40'");
  });

  test('contains no user-facing Rabby Wallet identity in UI or locale copy', () => {
    const ui = textFilesUnder('src/ui', [
      '.ts',
      '.tsx',
      '.html',
      '.json',
      '.md',
      '.svg',
      '.css',
      '.less',
    ]);
    const locales = [
      textFilesUnder('_raw/locales', ['.json']),
      textFilesUnder('_raw/_locales', ['.json']),
    ].join('\n');

    expect(ui).not.toContain('Rabby Wallet');
    expect(ui).not.toContain('@Rabby_io');
    expect(ui).not.toContain('support.rabby.io');
    expect(locales).not.toContain('Rabby Wallet');
    expect(locales).not.toContain('Rabby Points');
    expect(locales).not.toContain('Rabby Mobile');
  });

  test('announces Hippo Wallet to dapps while keeping compatibility aliases', () => {
    const pageProvider = read(
      'node_modules/@rabby-wallet/page-provider/dist/index.js'
    );
    const postinstall = JSON.parse(read('package.json')).scripts.postinstall;

    expect(pageProvider).toContain('name: "Hippo Wallet"');
    expect(pageProvider).toContain(
      'rdns: "finance.resupply.hippo-wallet"'
    );
    expect(pageProvider).toContain('this.isHippo = true');
    expect(pageProvider).toContain(
      'Object.defineProperty(window, "hippo"'
    );
    expect(pageProvider).toContain(
      'Object.defineProperty(window, "rabby"'
    );
    expect(postinstall).toContain('patch-page-provider-brand.js');
  });

  test('rebrands bundled hardware metadata and validates production output', () => {
    const trezorKeyring = read(
      'node_modules/@rabby-wallet/eth-trezor-keyring/dist/index.js'
    );
    const packageJson = JSON.parse(read('package.json'));

    expect(trezorKeyring).toContain("appName: 'Hippo Wallet'");
    expect(trezorKeyring).toContain(
      "appUrl: 'https://github.com/CWinthorpe/hippo-wallet'"
    );
    expect(trezorKeyring).not.toContain("appName: 'Rabby Wallet'");
    expect(packageJson.scripts['build:pro:default']).toContain(
      'patch-built-brand.js'
    );
  });

  test('ships generated browser icons and editable brand source', () => {
    [16, 19, 32, 38, 48, 64, 128, 512].forEach((size) => {
      const icon = path.join(root, `_raw/images/icon-${size}.png`);
      expect(fs.existsSync(icon)).toBe(true);
      expect(fs.statSync(icon).size).toBeGreaterThan(50);
    });
    expect(
      fs.existsSync(path.join(root, 'brand/hippo-wallet-icon.aseprite'))
    ).toBe(true);
  });
});
