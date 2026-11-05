jest.mock('@/constant', () => ({
  CHAINS: { ETH: { hex: '0x1', network: '1' } },
  CHAINS_ENUM: { ETH: 'ETH' },
}));

jest.mock('@/background/utils', () => ({ createPersistStore: jest.fn() }));

jest.mock('@/background/service', () => ({
  permissionService: { resetSitesWithUnsupportedChain: jest.fn() },
  sessionService: { broadcastEvent: jest.fn() },
}));

import { permissionService, sessionService } from '@/background/service';
import { syncChainService } from '@/background/service/syncChain';

// Hippo ships its reviewed chain inventory with the extension and never runs
// upstream's remote chain-list fetch (#4224), so the fetch-side cases of the
// upstream regressor (ETH-less list rejection) do not apply here. What Hippo
// keeps — and must keep working — is the disconnect/notify path that the
// startup permission bootstrap and custom-network removal call.
describe('syncChainService.disconnectSitesWithUnsupportedChain', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(permissionService.resetSitesWithUnsupportedChain)
      .mockReturnValue([]);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('disconnects and notifies the dapps whose chain was removed', () => {
    jest
      .mocked(permissionService.resetSitesWithUnsupportedChain)
      .mockReturnValue([
        { origin: 'https://a.com', isConnected: true },
        { origin: 'https://b.com', isConnected: false },
      ] as ReturnType<typeof permissionService.resetSitesWithUnsupportedChain>);

    syncChainService.disconnectSitesWithUnsupportedChain();

    expect(sessionService.broadcastEvent).toHaveBeenCalledTimes(2);
    expect(sessionService.broadcastEvent).toHaveBeenCalledWith(
      'accountsChanged',
      [],
      'https://a.com',
      true
    );
    expect(sessionService.broadcastEvent).toHaveBeenCalledWith(
      'chainChanged',
      { chain: '0x1', networkVersion: '1' },
      'https://a.com',
      true
    );
  });

  it('notifies nobody when every site chain is still supported', () => {
    syncChainService.disconnectSitesWithUnsupportedChain();

    expect(sessionService.broadcastEvent).not.toHaveBeenCalled();
  });
});
