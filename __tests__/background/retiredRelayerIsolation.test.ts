/**
 * @jest-environment node
 */
// Regressors for gpt56 round-3 blocker B4: the retired Rabby push-tx
// relayer must be unreachable and unpresent — no controller shims, no
// dynamic openapi dispatch hole, no retired endpoint strings in the
// installed API client, and pending-transaction display must work without
// any relayer call.

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const repo = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8');

import {
  RETAINED_OPENAPI_METHODS,
  RETAINED_FAKE_TESTNET_OPENAPI_METHODS,
  resolveRetainedNamespaceMethod,
  openapiMethodRejectedError,
  dispatchRetainedNamespaceCall,
} from '@/background/service/openapiMethodAllowlist';
import { REMOVED_ENDPOINT_PATTERNS } from '@/background/service/removedEndpointPatterns';
import { classifyRemoteDataEndpoint } from '@/background/service/remoteDataPolicy';

/**
 * Parse the installed rabby-api client: map every `this.<method> = ...`
 * assignment to the endpoint literals requested inside that assignment's
 * segment (up to the next assignment). Template-literal prefixes (`${...}`
 * host/restful segments) normalize to `v1` so /v\d+/ patterns match.
 */
const parseClientEndpoints = (clientSource: string): Map<string, string[]> => {
  const lines = clientSource.split('\n');
  const assignments: Array<[number, string]> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/this\.([A-Za-z0-9_$]+) = /);
    if (m) assignments.push([i, m[1]]);
  }
  const map = new Map<string, string[]>();
  for (let k = 0; k < assignments.length; k++) {
    const [start, name] = assignments[k];
    const end =
      k + 1 < assignments.length ? assignments[k + 1][0] : lines.length;
    const segment = lines.slice(start, end).join('\n');
    const endpoints: string[] = [];
    const re =
      /request\.(?:get|post|put|delete)\(\s*(?:'([^']+)'|"([^"]+)"|`([^`]+)`)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(segment))) {
      const raw = m[1] || m[2] || m[3] || '';
      endpoints.push(raw.replace(/\$\{[^}]+\}/g, 'v1'));
    }
    if (endpoints.length && !map.has(name)) map.set(name, endpoints);
  }
  return map;
};

describe('openapi dispatch allowlist rejects the retired relayer (B4)', () => {
  const RETIRED = ['withdrawTx', 'retryPushTx', 'quickCancelTx'];

  test('the executable dispatcher never runs a retired method', () => {
    let executed = 0;
    const namespaceObject = {
      withdrawTx: () => {
        executed += 1;
        return 'RETIRED-RAN';
      },
      retryPushTx: () => {
        executed += 1;
        return 'RETIRED-RAN';
      },
      preExecTx: (...args: unknown[]) => {
        executed += 1;
        return `ok:${args.length}`;
      },
    };

    for (const method of ['withdrawTx', 'retryPushTx', 'constructor', 'nope']) {
      expect(() =>
        dispatchRetainedNamespaceCall('openapi', namespaceObject, method, [])
      ).toThrow(/rejected/i);
    }
    expect(executed).toBe(0);

    // A retained method on the same object executes normally.
    expect(
      dispatchRetainedNamespaceCall('openapi', namespaceObject, 'preExecTx', [
        1,
        2,
      ])
    ).toBe('ok:2');
    // Non-function properties never execute.
    expect(() =>
      dispatchRetainedNamespaceCall(
        'openapi',
        { preExecTx: {} },
        'preExecTx',
        []
      )
    ).toThrow(/rejected/i);
  });

  test('deny-by-default: every retired relayer method is rejected in every namespace', () => {
    for (const namespace of ['openapi', 'fakeTestnetOpenapi'] as const) {
      for (const method of RETIRED) {
        expect(resolveRetainedNamespaceMethod(namespace, method)).toBeNull();
        expect(
          (namespace === 'openapi'
            ? RETAINED_OPENAPI_METHODS
            : RETAINED_FAKE_TESTNET_OPENAPI_METHODS
          ).has(method)
        ).toBe(false);
      }
    }
    // The rejection error names the exact rejected method — never a silent
    // fall-through to "whatever exists".
    const err = openapiMethodRejectedError('openapi', 'withdrawTx');
    expect(err.message).toContain('openapi.withdrawTx');
    expect(err.message).toMatch(/rejected/i);
  });

  test('unknown or spoofed methods are rejected; retained reads are allowed', () => {
    expect(resolveRetainedNamespaceMethod('openapi', 'constructor')).toBeNull();
    expect(resolveRetainedNamespaceMethod('openapi', '__proto__')).toBeNull();
    expect(resolveRetainedNamespaceMethod('openapi', '')).toBeNull();
    expect(resolveRetainedNamespaceMethod('openapi', 'then')).toBeNull();
    expect(resolveRetainedNamespaceMethod('openapi', 42 as never)).toBeNull();
    expect(
      resolveRetainedNamespaceMethod('openapi', 'getSummarizedAssetList')
    ).toBe('getSummarizedAssetList');
    expect(resolveRetainedNamespaceMethod('openapi', 'preExecTx')).toBe(
      'preExecTx'
    );
    expect(
      resolveRetainedNamespaceMethod('fakeTestnetOpenapi', 'getToken')
    ).toBe('getToken');
    expect(
      resolveRetainedNamespaceMethod('fakeTestnetOpenapi', 'withdrawTx')
    ).toBeNull();
  });

  test('both dispatch sites enforce the allowlist (UI proxy + background handler)', () => {
    const uiProxy = read('src/ui/wallet/createWallet.ts');
    const background = read('src/background/index.ts');
    expect(uiProxy).toContain('resolveRetainedNamespaceMethod');
    expect(uiProxy).toContain('openapiMethodRejectedError');
    // The background executes the shared dispatcher — no bespoke lookup.
    expect(background).toContain('dispatchRetainedNamespaceCall');
    // The old dynamic lookups (`walletController.openapi[data.method]`)
    // must be gone.
    expect(background).not.toMatch(/walletController\.openapi\[data\.method\]/);
    expect(background).not.toMatch(
      /walletController\.fakeTestnetOpenapi\[data\.method\]/
    );
  });

  test('controller and service relayer shims are deleted from source', () => {
    const controller = read('src/background/controller/wallet.ts');
    const history = read('src/background/service/transactionHistory.ts');
    expect(controller).not.toMatch(/quickCancelTx\s*=/);
    expect(controller).not.toMatch(/retryPushTx\s*=/);
    expect(history).not.toMatch(/quickCancelTx\s*=/);
    expect(history).not.toMatch(/retryPushTx\s*=/);
  });

  test('the retired history-gas endpoint is absent from the UI surface and client', () => {
    const client = read('node_modules/@rabby-wallet/rabby-api/dist/index.js');
    expect(RETAINED_OPENAPI_METHODS.has('historyGasUsed')).toBe(false);
    // BARE path tokens must not appear anywhere either: the packaged
    // runtime is scanned for these literals and a policy-regex copy would
    // ship them into background.js (weaker artifact-level removal proof).
    expect(client).not.toContain('history_tx_used_gas');
    expect(client).toContain('Historical gas endpoint is removed from Hippo Wallet');
    const signatureSteps = read(
      'src/ui/component/MiniSignV2/services/SignatureSteps.ts'
    );
    expect(signatureSteps).not.toMatch(/openapi\.historyGasUsed/);
    // Deny-regex/token-list modules carry zero history-gas literals; the
    // path stays fail-closed as UNCLASSIFIED (assertRequestAllowed denies
    // anything not capability-classified).
    const policy = read('src/background/service/remoteDataPolicy.ts');
    const patterns = read('src/background/service/removedEndpointPatterns.ts');
    expect(`${policy}\n${patterns}`).not.toContain('history_tx_used_gas');
    expect(
      classifyRemoteDataEndpoint('https://api.rabby.io/v1/wallet/history_tx_used_gas')
    ).toBeNull();
    expect(REMOVED_ENDPOINT_PATTERNS.length).toBeGreaterThan(10);
  });

  test('no RETAINED allowlist method maps onto any removed endpoint', () => {
    // Mechanical completeness (gpt56 round-5 R4-B2 closure): parse every
    // `this.<name> =` assignment in the installed client up to the next
    // assignment and collect the endpoint literals it requests; no retained
    // method may resolve to a REMOVED_ENDPOINT_PATTERNS path. Only the two
    // host-management methods may have no endpoint at all.
    const client = read('node_modules/@rabby-wallet/rabby-api/dist/index.js');
    const endpoints = parseClientEndpoints(client);
    const LOCAL_ONLY_METHODS = new Set(['getHost', 'setHost']);
    const offenders: string[] = [];
    const unmapped: string[] = [];
    for (const method of RETAINED_OPENAPI_METHODS) {
      const eps = endpoints.get(method);
      if (!eps) {
        if (!LOCAL_ONLY_METHODS.has(method)) unmapped.push(method);
        continue;
      }
      for (const ep of eps) {
        if (REMOVED_ENDPOINT_PATTERNS.some((pattern) => pattern.test(ep))) {
          offenders.push(`${method} -> ${ep}`);
        }
      }
    }
    expect(unmapped).toEqual([]);
    expect(offenders).toEqual([]);
    // The parser must actually see retired constructors removed from the
    // patched client, or the mapping test above is vacuous.
    expect(endpoints.has('withdrawTx')).toBe(false);
    expect(endpoints.has('retryPushTx')).toBe(false);
    expect(endpoints.has('historyGasUsed')).toBe(false);
    // Positive control: a retained read path IS mapped and clean.
    expect(endpoints.get('getTxRequests')).toEqual([
      '/v1/wallet/get_tx_requests',
    ]);
  });

  test('the installed rabby-api client carries zero retired endpoint strings and fails closed', () => {
    const client = read('node_modules/@rabby-wallet/rabby-api/dist/index.js');
    expect(client).not.toContain('/v1/wallet/transaction/withdraw_tx');
    expect(client).not.toContain('/v1/wallet/withdraw_tx');
    expect(client).not.toContain('/v1/wallet/transaction/retry_push_tx');
    expect(client).not.toContain('/v1/wallet/retry_push_tx');
    // Bare path tokens too — the packaged runtime is scanned for these.
    expect(client).not.toContain('withdraw_tx');
    expect(client).not.toContain('retry_push_tx');
    expect(client).not.toContain('history_tx_used_gas');
    // The neutralization must be reproduced on every install: the
    // patch-package file exists and covers the client.
    const patchPath = 'patches/@rabby-wallet+rabby-api+0.9.65.patch';
    expect(fs.existsSync(path.join(repo, patchPath))).toBe(true);
    const patch = read(patchPath);
    expect(patch).toContain('withdrawTx');
    expect(patch).toContain('retryPushTx');
    // No added line may reintroduce an endpoint string (they may only be
    // removed or reworded in comments).
    const addedLines = patch
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'));
    expect(
      addedLines.some((line) =>
        /withdraw_tx|retry_push_tx/.test(line.replace(/\\/g, ''))
      )
    ).toBe(false);
  });

  test('no call site references the retired relayer methods', () => {
    // Comments may name the removed methods (to document the deletion);
    // call/definition syntax must not exist anywhere.
    const callSites = (needle: string) =>
      execSync(
        `git grep -nE "[\\w.\\]] ${needle}|\\.${needle}\\(|${needle}\\s*=|${needle}\\(" -- src || true`,
        { cwd: repo, encoding: 'utf8' }
      ).trim();
    for (const needle of ['quickCancelTx', 'retryPushTx', 'withdrawTx']) {
      expect(callSites(needle)).toBe('');
    }
  });
});

describe('pending-transaction display works without the relayer (B4)', () => {
  test('pending grouping is computed locally with zero service calls', () => {
    // The pending classifier must work with the background service module
    // replaced by a recording stub: display classification needs no relayer
    // round-trip.
    jest.resetModules();
    jest.doMock('@/background/service/transactionHistory', () => ({
      __esModule: true,
      default: {
        getTxRequests: jest.fn(() => {
          throw new Error('relayer must not be consulted');
        }),
      },
    }));
    const { checkIsPendingTxGroup } = jest.requireActual<
      typeof import('@/utils/tx')
    >('@/utils/tx');

    const pendingGroup = {
      isPending: true,
      nonce: 3,
      chainId: 1,
      txs: [{ rawTx: { gasPrice: '0x1' }, reqId: 'r1', isSubmitFailed: false }],
    } as never;
    const withdrawnGroup = {
      isPending: true,
      nonce: 3,
      chainId: 1,
      txs: [{ rawTx: { gasPrice: '0x1' }, isWithdrawed: true }],
    } as never;

    expect(checkIsPendingTxGroup(pendingGroup)).toBe(true);
    expect(checkIsPendingTxGroup(withdrawnGroup)).toBe(false);
  });

  test('pending grouping relies only on local tx state, not withdrawal/retry calls', () => {
    // The pending-tx path used to consult the relayer through
    // reloadTxRequest/withdraw flows. Display classification must be
    // derivable from local state alone now that the shims are gone.
    const txUtils = read('src/utils/tx.ts');
    expect(txUtils).toContain('checkIsPendingTxGroup');
    // `isWithdrawed` is an inert legacy data flag on stored tx items; the
    // retired relayer METHODS/endpoints must not appear.
    expect(txUtils).not.toMatch(
      /withdrawTx|retryPushTx|quickCancelTx|withdraw_tx|retry_push_tx/
    );

    const history = read('src/background/service/transactionHistory.ts');
    // Pending lookups are pure local-store reads.
    const pendingFn = history.slice(
      history.indexOf('getPendingTxsByNonce'),
      history.indexOf('addSubmitFailedTransaction')
    );
    expect(pendingFn).toContain('this.store.transactions');
    expect(pendingFn).not.toContain('openapiService');
    expect(pendingFn).not.toMatch(/withdrawTx|retryPushTx|quickCancelTx/);
  });

  test('transactionHistory still reads unbroadcasted reqIds via the retained getTxRequests read only', () => {
    const history = read('src/background/service/transactionHistory.ts');
    // getTxRequests is a retained read (allowlisted); the retired write
    // endpoints are gone from the service entirely.
    expect(history).toContain('getTxRequests');
    expect(RETAINED_OPENAPI_METHODS.has('getTxRequests')).toBe(true);
    expect(history).not.toMatch(/withdrawTx|retryPushTx|quickCancelTx/);
    // The retired endpoint strings must be absent (isWithdrawed remains only
    // as an inert persisted-data flag consumed by updateTxByTxRequest).
    expect(history).not.toMatch(/withdraw_tx|retry_push_tx/);
  });
});
