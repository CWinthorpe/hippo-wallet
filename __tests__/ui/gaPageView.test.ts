/**
 * @jest-environment jsdom
 */
import browser from 'webextension-polyfill';
import { ga4 } from '@/utils/ga4';
import { resetUserDataTrackingCache } from '@/utils/user-data-tracking';
import { getPageViewPath } from '@/ui/utils/ga-event';

const ADDRESS = '0x5853ed4f26a3fcea565b3fbc698bb19cdf6deb85';

describe('GA page_view', () => {
  const fetchMock = jest.fn();

  beforeEach(async () => {
    resetUserDataTrackingCache();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({});
    global.fetch = (fetchMock as unknown) as typeof fetch;
    await browser.storage.local.set({
      clientId: 'test-client-id',
      preference: { userDataTrackingOptOut: false },
    });
  });

  test('keeps the route path and drops the query', () => {
    expect(
      getPageViewPath(
        `#/settings/address-detail?address=${ADDRESS}&type=HD%20Key%20Tree&brandName=Ledger`
      )
    ).toBe('/settings/address-detail');
    expect(
      getPageViewPath(`#/new-user/backup-seed-phrase?address=${ADDRESS}`)
    ).toBe('/new-user/backup-seed-phrase');
    expect(getPageViewPath('#/perps/single-coin/ETH')).toBe(
      '/perps/single-coin/ETH'
    );
    expect(getPageViewPath('')).toBe('');
  });

  // Hippo adaptation: upstream's regression asserts the GA wire format.
  // Hippo's ga4 facade is a permanent no-op (privateBuildPrivacy pins it), so
  // the pinned invariant here is that no network request is ever made and the
  // address/brand never leave the extension. getPageViewPath itself keeps the
  // query-stripping behavior under test above.
  test('never sends page_location anywhere', async () => {
    await ga4.firePageViewEvent({
      pageLocation: getPageViewPath(
        `#/settings/address-detail?address=${ADDRESS}&brandName=Ledger`
      ),
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
