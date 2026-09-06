let resolveBoundary: () => void;
let boundaryLocked = false;
const events: string[] = [];

jest.mock('@/background/service/notification', () => ({
  __esModule: true,
  default: {
    rejectAllApprovals: jest.fn(() => events.push('reject')),
    clear: jest.fn(() => events.push('clear')),
    bumpApprovalEpoch: jest.fn(() => events.push('epoch')),
  },
}));

jest.mock('@/background/service/remoteDataPolicy', () => ({
  __esModule: true,
  default: {
    lock: jest.fn(() => {
      boundaryLocked = true;
      events.push('lock');
      return new Promise<void>((resolve) => {
        resolveBoundary = resolve;
      });
    }),
  },
}));

import fs from 'fs';
import path from 'path';
import notificationService from '@/background/service/notification';
import remoteDataPolicyService from '@/background/service/remoteDataPolicy';
import { runWithSessionBoundary } from '@/background/service/sessionBoundary';

describe('reset session boundary ordering', () => {
  beforeEach(() => {
    events.length = 0;
    boundaryLocked = false;
    resolveBoundary = () => undefined;
    jest.clearAllMocks();
  });

  test('revokes approval and remote authority while keyring reset is stalled', async () => {
    let resolveReset: () => void = () => undefined;
    let resetStarted = false;
    const reset = runWithSessionBoundary(
      () =>
        new Promise<void>((resolve) => {
          resetStarted = true;
          resolveReset = resolve;
        })
    );

    await Promise.resolve();
    expect(resetStarted).toBe(true);
    expect(boundaryLocked).toBe(true);
    expect(events).toEqual(['reject', 'clear', 'epoch', 'lock']);
    expect(notificationService.rejectAllApprovals).toHaveBeenCalledTimes(1);
    expect(notificationService.bumpApprovalEpoch).toHaveBeenCalledTimes(1);
    expect(remoteDataPolicyService.lock).toHaveBeenCalledTimes(1);

    resolveReset();
    await Promise.resolve();
    let settled = false;
    reset.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveBoundary();
    await expect(reset).resolves.toBeUndefined();
  });

  test('WalletController reset methods use the boundary wrapper before keyring awaits', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/background/controller/wallet.ts'),
      'utf8'
    );
    expect(source).toMatch(
      /resetPassword = async \(password: string\) => \{\s*await runWithSessionBoundary\(\(\) => keyringService\.resetPassword\(password\)\)/
    );
    expect(source).toMatch(
      /resetBooted = async \(\) => \{\s*await runWithSessionBoundary\(\(\) => keyringService\.resetBooted\(\)\)/
    );
  });
});
