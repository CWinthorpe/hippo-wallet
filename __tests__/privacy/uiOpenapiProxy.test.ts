import fs from 'fs';
import path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('UI OpenAPI access stays background-proxied', () => {
  test('extension pages do not build a UI-local OpenApiService client', () => {
    // A UI-local client would carry its own fetch adapter and store and would
    // bypass the background remote-data consent policy, forced-policy
    // adapter, null API identity, and disabled Rabby RPC control plane.
    const uiWallet = read('src/ui/wallet/index.ts');
    expect(uiWallet).not.toContain('createOpenapiRuntime');
    expect(uiWallet).not.toContain('setNamespace');
    expect(uiWallet).toContain('walletClient.wallet');
  });

  test('background routes UI openapi calls through the hardened service', () => {
    const bg = read('src/background/index.ts');
    expect(bg).toContain("case 'openapi'");
    expect(bg).toContain('walletController.openapi[data.method]');
    const service = read('src/background/service/openapi.ts');
    expect(service).toContain('RABBY_RPC_DISABLED');
    expect(service).toContain('HIPPO_PUBLIC_OPENAPI_KEYS');
    // The background client must run the forced-policy adapter so every
    // host (including configured custom API hosts) passes the consent gate.
    expect(service).toContain(
      "import { rabbyOpenapiFetchAdapter } from '@/services/openapi/fetchAdapter'"
    );
    expect(service).toContain('adapter: rabbyOpenapiFetchAdapter');
  });
});
