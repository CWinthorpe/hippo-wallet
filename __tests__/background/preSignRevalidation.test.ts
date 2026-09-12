/**
 * @jest-environment node
 */
// gpt56 round-12 blocker 3: authority must be revalidated AFTER every
// asynchronous keyring lookup and IMMEDIATELY before each sign invocation
// (per item for the batched 7702 signer). A revocation landing while
// getKeyringForAccount/_checkAddress is in flight must produce ZERO signer
// calls — the post-sign assert alone cannot undo a device prompt or a
// keyring-side effect.
//
// Structural checks pin a tight window: the LAST assert call before each
// keyringService.sign* must occur within the final 400 chars before it
// (lookup-adjacent, comment-stripped), so a stray assert elsewhere in the
// function cannot satisfy the test.

import 'reflect-metadata';
import fs from 'fs';
import path from 'path';

const read = (p: string) =>
  fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');

let trace: string[] = [];

jest.mock('@/background/service/notification', () => ({
  __esModule: true,
  default: {
    approvalEpoch: 0,
    getOriginApprovalEpoch: (origin: string) =>
      (global as any).__originEpochs?.get(origin) ?? 0,
    rejectAllApprovals: jest.fn(() => trace.push('reject')),
    clear: jest.fn(() => trace.push('clear')),
    bumpApprovalEpoch: jest.fn(() => trace.push('epoch')),
    rejectApprovalsByOrigin: jest.fn((origin: string) =>
      trace.push(`reject-origin:${origin}`)
    ),
    bumpOriginApprovalEpoch: jest.fn((origin: string) => {
      if (!(global as any).__originEpochs) {
        (global as any).__originEpochs = new Map<string, number>();
      }
      (global as any).__originEpochs.set(
        origin,
        ((global as any).__originEpochs.get(origin) ?? 0) + 1
      );
      trace.push(`epoch-origin:${origin}`);
    }),
  },
}));

jest.mock('@/background/service/remoteDataPolicy', () => ({
  __esModule: true,
  default: { lock: jest.fn(() => Promise.resolve()) },
}));

const accountState = {
  current: null as null | {
    address: string;
    type?: string;
    brandName?: string;
  },
  isEnabledDappAccount: false,
};

jest.mock('@/background/service/preference', () => ({
  __esModule: true,
  default: {
    getCurrentAccount: jest.fn(() => accountState.current),
    setCurrentAccount: jest.fn((account: any) => {
      accountState.current = account;
    }),
    getPreference: jest.fn((key: string) =>
      key === 'isEnabledDappAccount'
        ? accountState.isEnabledDappAccount
        : undefined
    ),
  },
}));

const siteState = {
  hasPermission: true,
  site: null as null | {
    origin: string;
    chain?: string;
    account?: any;
    isConnected?: boolean;
  },
  internalOrigin: false,
};

jest.mock('@/background/service/permission', () => ({
  __esModule: true,
  default: {
    getSites: jest.fn(() => []),
    setAuthorityBoundary: jest.fn(),
    hasPermission: jest.fn(() => siteState.hasPermission),
    getConnectedSite: jest.fn(() => siteState.site),
    isInternalOrigin: jest.fn(() => siteState.internalOrigin),
  },
}));

import notificationService from '@/background/service/notification';
import {
  assertAuthorityContextStillValid,
  captureAuthorityContext,
  AuthorityContext,
} from '@/background/service/sessionBoundary';

const DAPP_ORIGIN = 'https://dapp.test';
const ACCOUNT_A = { address: '0xAa', type: 'HD', brandName: 'Hippo' };

const makeContext = (
  overrides: Partial<AuthorityContext> = {}
): AuthorityContext =>
  captureAuthorityContext({
    origin: DAPP_ORIGIN,
    boundAccount: ACCOUNT_A as any,
    boundChain: 'ETH',
    internalOrigin: false,
    operationId: 'op-1',
    requestDigest: '0xdigest',
    approvalComponent: 'SignTx',
    ...overrides,
  } as any);

/**
 * Within `region`, for each occurrence of `signCall`, require an
 * `assertAuthorityContextStillValid(` call after the LAST await of a
 * keyring lookup and within 400 chars of the sign call (tight,
 * lookup-adjacent window).
 */
const window = (
  src: string,
  lookupNeedle: string,
  signCallIdx: number,
  label: string
) => {
  const lookupIdx = src.lastIndexOf(lookupNeedle, signCallIdx);
  expect(lookupIdx).toBeGreaterThanOrEqual(0); // ${'label'} present
  const gap = src.slice(lookupIdx, signCallIdx);
  const lastAssert = gap.lastIndexOf('assertAuthorityContextStillValid(');
  expect(lastAssert).toBeGreaterThan(-1); // assert between lookup and signer
  // tight window: the assert sits within the last stretch before signing
  expect(gap.length - lastAssert).toBeLessThan(400); // label: immediately pre-signer
  void label;
};

describe('round-12 blocker 3: pre-signer revalidation wiring', () => {
  test('provider controller: transaction signers are guarded after the lookup', () => {
    const src = stripComments(
      read('src/background/controller/provider/controller.ts')
    );
    let idx = src.indexOf('keyringService.signTransaction');
    expect(idx).toBeGreaterThanOrEqual(0);
    let count = 0;
    while (idx !== -1 && count < 4) {
      window(
        src,
        'await this._checkAddress(txParams.from, options)',
        idx,
        `ethSendTransaction sign#${count}`
      );
      idx = src.indexOf('keyringService.signTransaction', idx + 1);
      count += 1;
    }
  });

  test('provider controller: personal + typed sinks guarded', () => {
    const src = stripComments(
      read('src/background/controller/provider/controller.ts')
    );
    const personal = src.indexOf('keyringService.signPersonalMessage');
    window(
      src,
      'await this._checkAddress(from, req)',
      personal,
      'personalSign'
    );
    const typed = src.indexOf('keyringService.signTypedMessage');
    // second _checkAddress occurrence belongs to the typed handler
    window(src, 'await this._checkAddress(from, req)', typed, 'typedData');
  });

  test('7702 batch loop revalidates per item', () => {
    const src = stripComments(
      read('src/background/controller/provider/controller.ts')
    );
    const loopAt = src.indexOf(
      'for (const authorization of eip7702RevokeAuthorization)'
    );
    expect(loopAt).toBeGreaterThanOrEqual(0);
    const signAt = src.indexOf(
      'keyringService.signEip7702Authorization',
      loopAt
    );
    const inside = src.slice(loopAt, signAt);
    expect(inside).toContain('assertAuthorityContextStillValid(');
  });

  test('WalletController sinks revalidate between lookup and signer', () => {
    const src = stripComments(read('src/background/controller/wallet.ts'));

    const personal = src.indexOf(
      'keyringService.signPersonalMessage',
      src.indexOf('signPersonalMessage = async (')
    );
    window(
      src,
      'getKeyringForAccount(from, type)',
      personal,
      'wallet.signPersonalMessage'
    );

    const typed = src.indexOf(
      'keyringService.signTypedMessage',
      src.indexOf('signTypedData = async (')
    );
    window(
      src,
      'getKeyringForAccount(from, type)',
      typed,
      'wallet.signTypedData'
    );

    const internal = src.indexOf(
      'keyringService.signTypedMessage',
      src.indexOf('signTypedDataInternal = async (')
    );
    window(
      src,
      'getKeyringForAccount(from, type)',
      internal,
      'wallet.signTypedDataInternal'
    );
  });

  test('behavioral: an invalidation landing mid-lookup prevents the signer from running at all', async () => {
    // Models the sink shape against the REAL assert primitive: pre-check
    // passes, the lookup awaits, a lock boundary crosses during the lookup,
    // and the sink-adjacent recheck must throw so the signer stub is NEVER
    // invoked.
    accountState.current = ACCOUNT_A as any;
    siteState.hasPermission = true;
    siteState.site = {
      origin: DAPP_ORIGIN,
      chain: 'ETH',
      account: ACCOUNT_A as any,
      isConnected: true,
    };
    siteState.internalOrigin = false;
    (global as any).__originEpochs = new Map();
    (notificationService as any).approvalEpoch = 5;

    const ctx = makeContext();

    let signerCalls = 0;
    const fakeKeyringLookup = () =>
      new Promise<string>((resolve) => {
        // a lock lands WHILE the lookup is in flight
        setTimeout(() => {
          (notificationService as any).approvalEpoch += 1;
          resolve('keyring-object');
        }, 0);
      });

    const sink = async () => {
      assertAuthorityContextStillValid(ctx, ACCOUNT_A as any); // entry check
      const keyring = await fakeKeyringLookup();
      // THE FIX (mirrored shape): revalidate after the lookup.
      assertAuthorityContextStillValid(ctx, ACCOUNT_A as any);
      signerCalls += 1;
      return `signed-by-${keyring}`;
    };

    await expect(sink()).rejects.toThrow(/approve again/i);
    expect(signerCalls).toBe(0);

    // Positive control: without a boundary crossing the same shape signs.
    signerCalls = 0;
    const c = makeContext();
    assertAuthorityContextStillValid(c, ACCOUNT_A as any);
    await Promise.resolve(); // no epoch change
    assertAuthorityContextStillValid(c, ACCOUNT_A as any);
    signerCalls += 1;
    expect(signerCalls).toBe(1);
  });
});
