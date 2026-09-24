/**
 * Hippo regression: upstream #4126 repaired the DappActions risky-method
 * blacklist (typo 'setApproveToAll' never matched, so setApprovalForAll /
 * transferFrom / safeTransferFrom actions were displayed and built as safe),
 * and #4125 added the per-chain Scroll-style L1 fee oracle map. These tests
 * pin the merged state against regressions during future sync merges.
 *
 * Import order note: '@/constant' must be required before the hook chain so
 * the consts ⇄ utils/chain cycle resolves the way the app bundle does.
 */
jest.mock('@/ui/hooks/backgroundState/useAccount', () => ({
  useCurrentAccount: jest.fn(),
}));
jest.mock('@/ui/utils', () => ({
  isSameAddress: (a: string, b: string) =>
    a?.toLowerCase() === b?.toLowerCase(),
  useWallet: jest.fn(),
}));
jest.mock('p-queue', () => ({ __esModule: true, default: class {} }));
jest.mock('@/ui/utils/portfolio/project', () => ({
  DisplayedProject: class {},
}));
jest.mock(
  '@/ui/views/CommonPopup/AssetList/components/DappActions/DappActionsForPopup',
  () => ({ ActionType: {} })
);
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));
jest.mock('@sentry/browser', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));

import {
  CAN_ESTIMATE_L1_FEE_CHAINS,
  CHAINS_ENUM,
  SCROLL_STYLE_L1_GAS_ORACLE,
} from '@/constant';
import { BLACKLIST_METHODS } from '@/ui/views/CommonPopup/AssetList/components/DappActions/constant';
import { isBlacklistMethodName } from '@/ui/views/CommonPopup/AssetList/components/DappActions/hook';

describe('DappActions blacklist (#4126 port)', () => {
  test('typo entry is gone and corrected risky names are present', () => {
    expect(BLACKLIST_METHODS).not.toContain('setApproveToAll');
    expect(BLACKLIST_METHODS).toEqual(
      expect.arrayContaining([
        'setApprovalForAll',
        'transferFrom',
        'safeTransferFrom',
      ])
    );
  });

  test.each(['setApprovalForAll', 'SETAPPROVALFORALL', 'setapprovalforall'])(
    'matches %s regardless of case',
    (name) => {
      expect(isBlacklistMethodName(name)).toBe(true);
    }
  );

  test('transferFrom and safeTransferFrom are blocked', () => {
    expect(isBlacklistMethodName('transferFrom')).toBe(true);
    expect(isBlacklistMethodName('safeTransferFrom')).toBe(true);
  });

  test.each(['swap', 'deposit', 'withdraw', 'claim', 'multicall'])(
    'does not block benign name %s',
    (name) => {
      expect(isBlacklistMethodName(name)).toBe(false);
    }
  );
});

describe('Scroll-style L1 fee oracle map (#4125 port)', () => {
  test('Scroll and Morph map to their distinct predeploys', () => {
    expect(SCROLL_STYLE_L1_GAS_ORACLE[CHAINS_ENUM.SCRL]).toBe(
      '0x5300000000000000000000000000000000000002'
    );
    // Upstream keys the map with the literal 'MORPH' (not a CHAINS_ENUM
    // member); fee routing looks chains up by the same string.
    expect(SCROLL_STYLE_L1_GAS_ORACLE['MORPH']).toBe(
      '0x530000000000000000000000000000000000000f'
    );
  });

  test('both chains participate in L1-fee balance estimation', () => {
    expect(CAN_ESTIMATE_L1_FEE_CHAINS).toContain(CHAINS_ENUM.SCRL);
    expect(CAN_ESTIMATE_L1_FEE_CHAINS).toContain('MORPH');
  });
});
