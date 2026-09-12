// Regressors for the v0.94.8 security backport majors that lack coverage
// elsewhere:
//  - #4087 (4d873ce80): remotely-synced explorer data can no longer become
//    a javascript:/data:/file: navigation sink.
//  - #4088 (8fe12cca9): the broadcast chain is pinned to the approval-time
//    approvalRes.chainId; the connected site's chain (attacker-mutable via
//    wallet_switchEthereumChain mid-approval) is fallback-only.
//
// #4087 is exercised behaviorally (pure util). #4088 lives inside the
// monolithic ethSendTransaction sink whose full runtime mock surface is
// prohibitive; per the established source-contract precedent in
// authorityContextRevalidation.test.ts the pin is asserted structurally
// AND the vacuity of the assertion is guarded by matching the old shape.

import fs from 'fs';
import path from 'path';

// Break the constant<->chain module cycle under jest (same technique as
// mainnetChainInventory.test.ts): these suites only need the pure utils.
jest.mock('webextension-polyfill', () => ({
  __esModule: true,
  default: { storage: { local: { get: jest.fn().mockResolvedValue({}) } } },
}));
jest.mock('consts', () => ({
  CHAINS: {},
  CHAINS_ENUM: { ETH: 'ETH' },
  EVENTS: { broadcastToUI: 'broadcastToUI' },
}));

// eslint-disable-next-line import/first
import {
  isValidHttpUrl,
  getAddressScanLink,
  getTxScanLink,
} from '@/utils';

const root = path.resolve(__dirname, '../..');
const read = (p: string) =>
  fs.readFileSync(path.join(root, p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('#4087 explorer-link protocol gate', () => {
  test('isValidHttpUrl admits only http(s) absolute URLs', () => {
    expect(isValidHttpUrl('https://etherscan.io/tx/_s_')).toBe(true);
    expect(isValidHttpUrl('http://example.com')).toBe(true);
    expect(isValidHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('JavaScript:alert(1)')).toBe(false);
    expect(isValidHttpUrl('data:text/html,<script>1</script>')).toBe(false);
    expect(isValidHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isValidHttpUrl('blob:https://x/y')).toBe(false);
    expect(isValidHttpUrl('about:blank')).toBe(false);
    expect(isValidHttpUrl('')).toBe(false);
    expect(isValidHttpUrl('not a url')).toBe(false);
  });

  test('scan-link builders return the empty string for unsafe inputs', () => {
    const hash = '0xdeadbeef';
    expect(
      getAddressScanLink('javascript:alert(document.cookie)', hash)
    ).toBe('');
    expect(getTxScanLink(`javascript:x${hash}`, hash)).toBe('');
    expect(getAddressScanLink(undefined as any, hash)).toBe('');
    expect(getTxScanLink(null as any, hash)).toBe('');
    // Positive control: honest links still build (assertion is non-vacuous).
    expect(getTxScanLink('https://etherscan.io/tx/_s_', hash)).toBe(
      `https://etherscan.io/tx/${hash}`
    );
    expect(
      getAddressScanLink('https://etherscan.io/transaction/_s_', hash)
    ).toBe(`https://etherscan.io/address/${hash}`);
  });

  test('no UI explorer-link sink bypasses the gate', () => {
    // Every consumer path is either the gated builders or a literal; a raw
    // chain.scanLink/scan_address into window.open/href would defeat it.
    const sources = [
      'src/ui/views/TransactionHistory/components/TransactionItem.tsx',
      'src/ui/hooks/useChain.ts',
    ];
    for (const s of sources) {
      const src = read(s);
      expect(src).not.toMatch(/window\.open\(\s*\w+\?\.scanLink/);
      expect(src).not.toMatch(/href=\{[^}]*\bchain\?\.scanLink\}/);
    }
    // The ManageApprovals opener must route through the gated builder.
    const opener = read('src/ui/views/ManageApprovals/utils.ts');
    expect(opener).toMatch(
      /openInTab\(getAddressScanLink\(scanLink, address\)\)/
    );
  });
});

describe('#4088 broadcast chain pinned to approval-time chainId', () => {
  const controller = read('src/background/controller/provider/controller.ts');

  test('the broadcast chain derives from approvalRes.chainId first', () => {
    const pin =
      /const chain = \(findChain\(\{ id: approvalRes\.chainId \}\)\?\.enum \?\?\s*permissionService\.getConnectedSite\(origin\)\?\.chain\) as CHAINS_ENUM;/;
    expect(controller).toMatch(pin);
  });

  test('the attacker-mutable mid-approval site-chain selection is gone', () => {
    // Pre-fix shape: ternary selecting the CONNECTED SITE's chain for
    // external dApp origins. Its presence means the pin was reverted.
    expect(controller).not.toMatch(
      /permissionService\.getConnectedSite\(origin\)!\.chain;\s*\n?\s*const approvingTx/
    );
    expect(controller).not.toMatch(
      /\? \(findChain\(\{\s*id: approvalRes\.chainId,\s*\}\)\?\.enum as CHAINS_ENUM\)\s*:\s*permissionService\.getConnectedSite\(origin\)!\.chain/
    );
  });

  test('site fallback is optional-chained (never throws post-disconnect)', () => {
    expect(controller).toMatch(
      /permissionService\.getConnectedSite\(origin\)\?\.chain/
    );
    expect(controller).not.toMatch(
      /getConnectedSite\(origin\)!\.chain\)\s*as CHAINS_ENUM/
    );
  });
});
