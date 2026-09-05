const mockStore: Record<string, unknown> = {
  userDataTrackingOptOut: true,
  isShowTestnet: false,
  locale: 'en',
  addressSortStore: {
    search: '',
    lastCurrentRecordTime: Date.now(),
    lastCurrent: 'ETH',
  },
};

jest.mock('background/utils', () => ({
  createPersistStore: jest.fn(async () => mockStore),
  isSameAddress: (a: string, b: string) =>
    String(a).toLowerCase() === String(b).toLowerCase(),
  patchPersistStore: jest.fn((store, partials) => {
    Object.assign(store, partials);
  }),
}));

jest.mock('@/background/service/openapi', () => ({
  __esModule: true,
  default: { getSupportedDEXList: jest.fn() },
  GasLevel: {},
}));

jest.mock('@/background/service/index', () => ({
  keyringService: { isUnlocked: () => false },
  sessionService: {
    addConnectSite: jest.fn(),
    getConnectedSites: jest.fn(() => ({})),
    recentConnectedSites: [],
  },
  i18n: {
    getLocale: jest.fn(() => 'en'),
    changeLanguage: jest.fn(),
    getFirstPreferredLangCode: jest.fn(() => 'en'),
  },
  permissionService: {
    getConnectedSites: jest.fn(() => ({})),
    removeSite: jest.fn(),
    addSite: jest.fn(),
  },
}));

jest.mock('background/utils/broadcastToUI', () => ({
  syncStateToUI: jest.fn(),
}));

jest.mock('@/background/webapi/tab', () => ({
  getCurrentTabId: jest.fn(),
  tabEvent: { on: jest.fn(), emit: jest.fn() },
  subscribe: jest.fn(),
  unSubscribe: jest.fn(),
}));

jest.mock('@/background/webapi/window', () => ({
  default: { openNotification: jest.fn(), remove: jest.fn() },
}));

jest.mock('@/background/webapi/notification', () => ({
  default: { create: jest.fn(), clear: jest.fn() },
}));

import preferenceService from '@/background/service/preference';

describe('preference privacy pins at the read boundary', () => {
  test('a legacy persisted opt-out=false can never be read back', async () => {
    // Simulate an upgraded profile whose persisted store predates the pin.
    (preferenceService as any).store = mockStore;
    mockStore.userDataTrackingOptOut = false;

    expect(preferenceService.getPreference('userDataTrackingOptOut')).toBe(
      true
    );

    const snapshot = preferenceService.getPreference() as Record<
      string,
      unknown
    >;
    expect(snapshot.userDataTrackingOptOut).toBe(true);

    // The dedicated pins remain in force as well.
    preferenceService.setUserDataTrackingOptOut(false);
    expect(preferenceService.getUserDataTrackingOptOut()).toBe(true);
    expect(mockStore.userDataTrackingOptOut).toBe(true);
  });
});
