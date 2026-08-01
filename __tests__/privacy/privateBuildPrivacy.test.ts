import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (relativePath: string) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

describe('private-build privacy invariants', () => {
  test('ships no upstream analytics client or credentials', () => {
    const packageJson = JSON.parse(read('package.json'));
    expect(packageJson.dependencies?.['@debank/festats']).toBeUndefined();
    expect(
      packageJson.devDependencies?.['@sentry/webpack-plugin']
    ).toBeUndefined();
    expect(packageJson.scripts?.['upload:sourcemap']).toBeUndefined();

    const telemetrySources = [
      'src/stats.ts',
      'src/utils/ga4.ts',
      'src/utils/matomo-request.ts',
      'src/utils/sentry-config.ts',
      'src/utils/user-data-tracking.ts',
    ]
      .map(read)
      .join('\n');

    [
      'G-XDNGZ67KEW',
      '_Im8XzsSR1u_y9mMMyT48w',
      'https://matomo.debank.com/matomo.php',
      'ingest.us.sentry.io',
    ].forEach((trackingIdentity) => {
      expect(telemetrySources).not.toContain(trackingIdentity);
    });
  });

  test('functional API traffic has no persistent installation identifier', () => {
    const openapiSource = read('src/background/service/openapi.ts');
    expect(openapiSource).not.toContain('uuidv4');
    expect(openapiSource).not.toContain('generateAPIKey');
    expect(openapiSource).toContain('this.store.apiKey = null');
    expect(openapiSource).toContain('this.store.apiTime = null');
  });

  test('does not ship or load the upstream Matomo browser client', () => {
    const htmlEntrypoints = [
      'src/ui/popup.html',
      'src/ui/desktop.html',
      'src/ui/index.html',
      'src/ui/notification.html',
    ]
      .map(read)
      .join('\n');

    expect(htmlEntrypoints).not.toContain('vendor/matomo.js');
    expect(fs.existsSync(path.join(root, '_raw/vendor/matomo.js'))).toBe(false);
    expect(fs.existsSync(path.join(root, '_raw/vendor/matomo.client.js'))).toBe(
      false
    );
  });

  test('blocks known upstream tracking hosts for every MV3 resource type', () => {
    const rules = JSON.parse(read('_raw/rules/privacy.json')) as Array<{
      action: { type: string };
      condition: { urlFilter: string; resourceTypes?: string[] };
    }>;
    const byFilter = new Map(
      rules.map((rule) => [rule.condition.urlFilter, rule])
    );

    [
      '||google-analytics.com^',
      '||matomo.debank.com^',
      '||sentry.io^',
      '||rabby.io/uninstalled',
      '||api.rabby.io/v1/engine/action/log',
      '||api.rabby.io/v1/chainrpc',
      '||api.rabby.io/v1/wallet/eth_rpc',
    ].forEach((urlFilter) => {
      expect(byFilter.get(urlFilter)?.action.type).toBe('block');
      expect(byFilter.get(urlFilter)?.condition.resourceTypes).toBeUndefined();
    });

    [
      'src/manifest/chrome-mv3/manifest.json',
      'src/manifest/chrome-mv3/manifest.dev.json',
    ].forEach((manifestPath) => {
      const manifest = JSON.parse(read(manifestPath));
      expect(manifest.permissions).toContain('declarativeNetRequest');
      expect(manifest.declarative_net_request.rule_resources).toContainEqual({
        id: 'privacy',
        enabled: true,
        path: 'rules/privacy.json',
      });
    });
  });

  test('does not inject the dapp provider into the temporary quote-origin tab', () => {
    [
      'src/manifest/chrome-mv3/manifest.json',
      'src/manifest/chrome-mv3/manifest.dev.json',
    ].forEach((manifestPath) => {
      const manifest = JSON.parse(read(manifestPath));
      const pageProviderScript = manifest.content_scripts.find(
        (entry: { js?: string[] }) =>
          entry.js?.includes('content-script.js')
      );
      expect(pageProviderScript?.exclude_matches).toContain(
        'https://swap-api.defillama.com/*'
      );
    });
  });

  test('cannot emit security action telemetry or use Rabby as the RPC control plane', () => {
    const approvalSources = [
      'src/ui/views/Approval/components/SignTx.tsx',
      'src/ui/views/Approval/components/SignText.tsx',
      'src/ui/views/Approval/components/SignTypedData.tsx',
    ]
      .map(read)
      .join('\n');
    expect(approvalSources).not.toContain('.postActionLog(');
    expect(approvalSources).not.toContain('reportLogId');

    const rpcSource = read('src/background/service/rpc.ts');
    expect(rpcSource).not.toContain('api.rabby.io/v1/chainrpc');
    expect(rpcSource).not.toContain('openapiService.getDefaultRPCs');
    expect(rpcSource).not.toContain('openapiService.ethRpc');
  });

  test('cannot retain an upstream uninstall report or background Sentry client', () => {
    const uninstallService = read('src/background/service/uninstalled.ts');
    expect(uninstallService).toContain("setUninstallURL('')");
    expect(uninstallService).not.toContain('rabby.io/uninstalled?');

    const background = read('src/background/index.ts');
    expect(background).not.toContain('Sentry.init(');
    expect(background).not.toContain('ALARMS_USER_ENABLE');

    const uiApp = read('src/ui/app.tsx');
    expect(uiApp).not.toContain('Sentry.init(');

    const sourceMapBuild = read('build/webpack.sourcemap.config.js');
    expect(sourceMapBuild).not.toMatch(/sentry/i);
    const releaseBuild = read('build/release.js');
    expect(releaseBuild).not.toMatch(/sentry/i);

    const onboarding = [
      read('src/ui/views/NewUserImport/PasswordCard.tsx'),
      read('src/ui/views/CreatePassword.tsx'),
    ].join('\n');
    expect(onboarding).not.toContain('setUserDataTrackingOptOut(false)');

    const preferenceModel = read('src/ui/models/preference.ts');
    expect(preferenceModel).not.toContain('userDataTrackingOptOut: value');
    expect(preferenceModel).not.toContain('setUserDataTrackingOptOut(value)');

    const dashboard = read(
      'src/ui/views/Dashboard/components/DashboardPanel/index.tsx'
    );
    const settings = read(
      'src/ui/views/Dashboard/components/Settings/index.tsx'
    );
    expect(dashboard).not.toContain('<RateModal');
    expect(settings).not.toContain('<RateModalTriggerOnSettings');

    const mv2Manifest = JSON.parse(
      read('src/manifest/chrome-mv2/manifest.json')
    );
    expect(mv2Manifest.content_security_policy).not.toContain(
      'google-analytics.com'
    );
  });

  test('does not ship removed product services, routes, or SDK dependencies', () => {
    const packageJson = JSON.parse(read('package.json'));
    for (const dependency of [
      '@rabby-wallet/rabby-swap',
      '@rabby-wallet/rabby-bridge',
      '@rabby-wallet/hyperliquid-sdk',
      '@rabby-wallet/staking-sdk',
      '@opensea/seaport-js',
    ]) {
      expect(packageJson.dependencies?.[dependency]).toBeUndefined();
    }

    for (const removedPath of [
      'src/background/service/bridge.ts',
      'src/background/service/gasAccount.ts',
      'src/background/service/perps.ts',
      'src/background/service/perpsLive.ts',
      'src/background/service/rabbyPoints.ts',
      'src/background/service/swap.ts',
      'src/background/service/transactionBroadcastWatcher.ts',
      'src/ui/views/Bridge',
      'src/ui/views/Perps',
      'src/ui/views/DesktopPerps',
      'src/ui/views/Staking',
      'src/ui/views/RabbyPoints',
    ]) {
      expect(fs.existsSync(path.join(root, removedPath))).toBe(false);
    }

    const routes = read('src/ui/views/MainRoute.tsx');
    const walletController = read('src/background/controller/wallet.ts');
    for (const removedRoute of [
      '/bridge',
      '/perps',
      '/staking',
      '/rabby-points',
      '/gas-account',
    ]) {
      expect(routes).not.toContain(removedRoute);
    }
    expect(walletController).not.toContain('postGasStationOrder');
    expect(walletController).not.toContain('gasTopUp =');

    const approvalSources = [
      'src/ui/views/Approval/components/SignTx.tsx',
      'src/ui/views/Approval/components/MiniSignTx/MiniSignTxV2.tsx',
      'src/ui/component/MiniSignV2/services/SignatureSteps.ts',
      'src/ui/views/Approval/components/BroadcastMode/index.tsx',
    ]
      .map(read)
      .join('\n');
    for (const removedCall of [
      '.gasLessTxCheck(',
      '.gasLessTxsCheck(',
      '.checkGasAccountTxs(',
      '.gasPriceStats(',
      '.gasSupportedPushType(',
    ]) {
      expect(approvalSources).not.toContain(removedCall);
    }
  });

  test('ships the consent gate and one-destination replacement paths', () => {
    const app = read('src/ui/views/index.tsx');
    const policy = read('src/background/service/remoteDataPolicy.ts');
    const rpc = read('src/background/service/rpc.ts');
    const llamaSwap = read('src/background/service/llamaSwap.ts');

    expect(app).toContain('<RemoteDataPolicyGate>');
    expect(policy).toContain("configured: false");
    expect(policy).toContain('REMOTE_DATA_UNCLASSIFIED');
    expect(policy).toContain('REMOTE_FEATURE_REMOVED');
    expect(rpc).toContain('https://rpc.mevblocker.io/fullprivacy');
    expect(rpc).toContain('submitRawTransaction');
    expect(llamaSwap).toContain(
      'https://swap-api.defillama.com/dexAggregatorQuote'
    );
    expect(llamaSwap).toContain('validateLlamaSwapQuote');
  });
});
