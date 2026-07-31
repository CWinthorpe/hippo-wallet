/**
 * @jest-environment jsdom
 */
import browser from 'webextension-polyfill';
import {
  PRIVATE_BUILD_TELEMETRY_DISABLED,
  resetUserDataTrackingCache,
  shouldReportUserBehaviorData,
  updateUserDataTrackingCache,
} from '@/utils/user-data-tracking';

jest.mock('webextension-polyfill', () => ({
  storage: {
    local: {
      get: jest.fn(),
    },
  },
}));

const mockStorageGet = browser.storage.local.get as jest.Mock;

describe('private-build telemetry policy', () => {
  beforeEach(() => {
    mockStorageGet.mockReset();
    resetUserDataTrackingCache();
  });

  test('is compile-time disabled', async () => {
    expect(PRIVATE_BUILD_TELEMETRY_DISABLED).toBe(true);
    await expect(shouldReportUserBehaviorData()).resolves.toBe(false);
    expect(mockStorageGet).not.toHaveBeenCalled();
  });

  test('cannot be re-enabled by a stored preference', async () => {
    mockStorageGet.mockResolvedValue({
      preference: {
        userDataTrackingOptOut: false,
      },
    });
    updateUserDataTrackingCache({ userDataTrackingOptOut: false });

    await expect(shouldReportUserBehaviorData()).resolves.toBe(false);
    expect(mockStorageGet).not.toHaveBeenCalled();
  });
});
