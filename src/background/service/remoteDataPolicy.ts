import browser from 'webextension-polyfill';
import {
  EMPTY_REMOTE_DATA_CAPABILITIES,
  REMOTE_DATA_CAPABILITIES,
  REMOTE_DATA_POLICY_VERSION,
  RemoteDataCapability,
  RemoteDataCapabilityState,
  RemoteDataPolicy,
} from '@/types/remoteDataPolicy';

export {
  EMPTY_REMOTE_DATA_CAPABILITIES,
  REMOTE_DATA_CAPABILITIES,
  REMOTE_DATA_POLICY_VERSION,
} from '@/types/remoteDataPolicy';
export type {
  RemoteDataCapability,
  RemoteDataCapabilityState,
  RemoteDataPolicy,
} from '@/types/remoteDataPolicy';

export const REMOTE_DATA_POLICY_STORAGE_KEY = 'hippoRemoteDataPolicy';

const DEFAULT_POLICY: RemoteDataPolicy = {
  version: REMOTE_DATA_POLICY_VERSION,
  configured: false,
  capabilities: { ...EMPTY_REMOTE_DATA_CAPABILITIES },
  lastContacts: {},
  updatedAt: null,
};

const REMOTE_DATA_BLOCK_RULE_ID = 910001;
const REMOTE_MEDIA_BLOCK_RULE_ID = 910002;
const REMOTE_PROVIDER_REGEX =
  '^https?://([^/]+\\.)?(rabby\\.io|debank\\.com)(/|$)';

const REMOVED_ENDPOINT_PATTERNS = [
  /^\/v\d+\/points(?:\/|$)/,
  /^\/v\d+\/badge(?:\/|$)/,
  /^\/v\d+\/(?:wallet\/)?gas_account(?:\/|$)/,
  /^\/v\d+\/(?:wallet\/)?gas_station(?:\/|$)/,
  /^\/v\d+\/bridge(?:\/|$)/,
  /^\/v\d+\/user\/dbk\/bridge_/,
  /^\/v\d+\/staking(?:\/|$)/,
  /^\/v\d+\/faucet(?:\/|$)/,
  /^\/v\d+\/wallet\/(?:tx_is_gasless|txs_is_gasless|submit_tx|push_tx|retry_push_tx|withdraw_tx|supported_push_type)(?:\/|$)/,
  /^\/v\d+\/wallet\/(?:gas_market|gas_price_stats|history_tx_used_gas|estimate_gas)(?:\/|$)/,
  /^\/v\d+\/wallet\/(?:swap_quote|swap_dex_list|supported_dex_list|swap_trade|swap_trade_list|check_slippage|suggest_slippage)(?:\/|$)/,
  /^\/v\d+\/nft\/(?:trading_config|order|fee)(?:\/|$)/,
  /^\/v\d+\/token\/hyperliquid_/,
  /^\/v\d+\/user\/has_hyperliquid_permission$/,
  /^\/v\d+\/engine\/action\/log$/,
  /^\/v\d+\/chainrpc$/,
  /^\/v\d+\/wallet\/eth_rpc$/,
] as const;

const ENDPOINT_CAPABILITY_RULES: ReadonlyArray<{
  pattern: RegExp;
  capabilities: readonly RemoteDataCapability[];
}> = [
  {
    pattern: /^\/v\d+\/user\/(?:total_balance(?:_24h)?|token(?:_list|_search)?|cache_token_list|specific_token_list|simple_protocol_list|protocol(?:_list)?|complex_protocol_list|summarized_asset_list|complex_app_list|used_chain_list|history_curve)(?:\/|$)/,
    capabilities: ['portfolio'],
  },
  {
    pattern: /^\/v\d+\/token\/(?:price|price_change|price_list|history_price|history_price_dict|identity|search|list_by_uuids|date_price|price_curve|24h_price)(?:\/|$)/,
    capabilities: ['portfolio', 'signing'],
  },
  {
    pattern: /^\/v\d+\/user\/(?:history_list|has_new_tx|history_token_list|history_protocol)(?:\/|$)/,
    capabilities: ['history'],
  },
  {
    pattern: /^\/v\d+\/wallet\/(?:pending_tx_count|pending_tx_list|get_tx|get_tx_requests|get_tx_request)(?:\/|$)/,
    capabilities: ['history', 'signing'],
  },
  {
    pattern: /^\/v\d+\/user\/(?:nft_list|collection_list)(?:\/|$)/,
    capabilities: ['nft'],
  },
  {
    pattern: /^\/v\d+\/nft(?:\/collections)?(?:\/|$)/,
    capabilities: ['nft', 'signing'],
  },
  {
    pattern: /^\/v\d+\/wallet\/(?:check_origin|check_text|check_tx|pre_exec_tx|trace_tx|explain_text|explain_typed_data|check_typed_data|mempool_checks|get_latest_pre_exec)(?:\/|$)/,
    capabilities: ['signing'],
  },
  {
    pattern: /^\/v\d+\/engine\/action\/(?:parse_tx|parse_text|parse_typed_data|parse_common)(?:\/|$)/,
    capabilities: ['signing'],
  },
  {
    pattern: /^\/v\d+\/user\/(?:token_authorized_list|nft_authorized_list|approval_status|total_approval_asset_cnt)(?:\/|$)/,
    capabilities: ['approvals'],
  },
  {
    pattern: /^\/v\d+\/engine\/(?:origin|addr|contract|token|collection)(?:\/|$)/,
    capabilities: ['security', 'signing'],
  },
  {
    pattern: /^\/v\d+\/(?:contract|cex)(?:\/|$)/,
    capabilities: ['security', 'signing'],
  },
  {
    pattern: /^\/v\d+\/wallet\/(?:support_chain|support_origin|support_selector|recommend_chains)(?:\/|$)/,
    capabilities: ['security', 'dapps'],
  },
  {
    pattern: /^\/v\d+\/dapp(?:\/|$)/,
    capabilities: ['dapps'],
  },
  {
    pattern: /^\/v\d+\/(?:feedback|wallet\/add_origin_feedback)(?:\/|$)/,
    capabilities: ['feedback'],
  },
  {
    pattern: /^\/v\d+\/currency\/exchange_list$/,
    capabilities: ['portfolio'],
  },
  {
    pattern: /^\/v\d+\/chain\/(?:list|total_list|get_list|classify_supported_list|offline_list)$/,
    capabilities: ['portfolio', 'history', 'nft', 'dapps'],
  },
];

const normalizePath = (url: string) => {
  try {
    const parsed = new URL(url, 'https://hippo.invalid');
    const path = parsed.pathname.startsWith('/')
      ? parsed.pathname
      : `/${parsed.pathname}`;
    return path.replace(/\/$/, '') || '/';
  } catch {
    return '/';
  }
};

export const isKnownRabbyOrDeBankUrl = (url: string) => {
  try {
    const hostname = new URL(
      url,
      'https://hippo.invalid'
    ).hostname.toLowerCase();
    return (
      hostname === 'rabby.io' ||
      hostname.endsWith('.rabby.io') ||
      hostname === 'debank.com' ||
      hostname.endsWith('.debank.com')
    );
  } catch {
    return false;
  }
};

export const classifyRemoteDataEndpoint = (
  url: string
): readonly RemoteDataCapability[] | 'removed' | null => {
  const path = normalizePath(url);
  if (REMOVED_ENDPOINT_PATTERNS.some((pattern) => pattern.test(path))) {
    return 'removed';
  }
  return (
    ENDPOINT_CAPABILITY_RULES.find(({ pattern }) => pattern.test(path))
      ?.capabilities || null
  );
};

const normalizePolicy = (value: unknown): RemoteDataPolicy => {
  if (!value || typeof value !== 'object') {
    return {
      ...DEFAULT_POLICY,
      capabilities: { ...EMPTY_REMOTE_DATA_CAPABILITIES },
    };
  }
  const input = value as Partial<RemoteDataPolicy>;
  const capabilities = { ...EMPTY_REMOTE_DATA_CAPABILITIES };
  const lastContacts: RemoteDataPolicy['lastContacts'] = {};
  REMOTE_DATA_CAPABILITIES.forEach((capability) => {
    capabilities[capability] = Boolean(input.capabilities?.[capability]);
    const contact = input.lastContacts?.[capability];
    if (
      contact?.capability === capability &&
      typeof contact.hostname === 'string' &&
      typeof contact.at === 'number' &&
      Number.isFinite(contact.at)
    ) {
      lastContacts[capability] = { ...contact };
    }
  });
  return {
    version: REMOTE_DATA_POLICY_VERSION,
    configured: input.configured === true,
    capabilities,
    lastContacts,
    updatedAt:
      typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt)
        ? input.updatedAt
        : null,
  };
};

const clonePolicy = (policy: RemoteDataPolicy): RemoteDataPolicy => ({
  ...policy,
  capabilities: { ...policy.capabilities },
  lastContacts: { ...policy.lastContacts },
});

export class RemoteDataPolicyError extends Error {
  code:
    | 'REMOTE_DATA_DISABLED'
    | 'REMOTE_DATA_UNCLASSIFIED'
    | 'REMOTE_FEATURE_REMOVED';
  capability?: RemoteDataCapability;

  constructor(
    code: RemoteDataPolicyError['code'],
    message: string,
    capability?: RemoteDataCapability
  ) {
    super(message);
    this.name = 'RemoteDataPolicyError';
    this.code = code;
    this.capability = capability;
  }
}

export class RemoteDataPolicyService {
  private policy: RemoteDataPolicy = clonePolicy(DEFAULT_POLICY);
  private initPromise?: Promise<void>;
  private policyChangeListeners = new Set<() => void>();
  // Fail closed: the service is created in the session-locked state so a
  // service-worker restart can never transiently re-enable Rabby/DeBank
  // consent before the wallet's own lock state is known. `unlock()` is the
  // only path that re-applies saved consent, and it runs only after the
  // keyring reports unlocked.
  private locked = true;

  init = async () => {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const stored = await browser.storage.local.get(
          REMOTE_DATA_POLICY_STORAGE_KEY
        );
        this.policy = normalizePolicy(stored[REMOTE_DATA_POLICY_STORAGE_KEY]);
        await this.updateNetworkRules();
      })();
    }
    return this.initPromise;
  };

  getPolicy = () => clonePolicy(this.policy);

  isConfigured = () => this.policy.configured;

  isLocked = () => this.locked;

  isAllowed = (capability: RemoteDataCapability) =>
    this.policy.configured &&
    !this.locked &&
    this.policy.capabilities[capability] === true;

  /**
   * Session boundary: locking the wallet revokes Rabby/DeBank capability
   * access until an explicit unlock. In-memory only — the user's saved
   * consent is preserved and re-applied by `unlock()`. Emitting a policy
   * change aborts in-flight remote requests via the fetch-adapter listener,
   * and the deny-by-default network rules are reinstalled.
   */
  lock = async () => {
    this.locked = true;
    this.emitPolicyChange();
    await this.updateNetworkRules();
  };

  unlock = async () => {
    this.locked = false;
    this.emitPolicyChange();
    await this.updateNetworkRules();
  };

  onPolicyChange = (listener: () => void) => {
    this.policyChangeListeners.add(listener);
    return () => this.policyChangeListeners.delete(listener);
  };

  private emitPolicyChange = () => {
    this.policyChangeListeners.forEach((listener) => listener());
  };

  setPolicy = async (capabilities: Partial<RemoteDataCapabilityState>) => {
    const next: RemoteDataPolicy = {
      version: REMOTE_DATA_POLICY_VERSION,
      configured: true,
      capabilities: { ...EMPTY_REMOTE_DATA_CAPABILITIES },
      lastContacts: { ...this.policy.lastContacts },
      updatedAt: Date.now(),
    };
    REMOTE_DATA_CAPABILITIES.forEach((capability) => {
      next.capabilities[capability] = Boolean(capabilities[capability]);
    });

    const reducesAccess = REMOTE_DATA_CAPABILITIES.some(
      (capability) =>
        this.policy.capabilities[capability] && !next.capabilities[capability]
    );
    if (reducesAccess) {
      this.policy = clonePolicy(next);
      this.emitPolicyChange();
      await this.updateNetworkRules();
    }

    await browser.storage.local.set({
      [REMOTE_DATA_POLICY_STORAGE_KEY]: next,
    });
    this.policy = clonePolicy(next);
    if (!reducesAccess) {
      this.emitPolicyChange();
    }
    await this.updateNetworkRules();
    return this.getPolicy();
  };

  disableAll = () => this.setPolicy(EMPTY_REMOTE_DATA_CAPABILITIES);

  recordRequestContact = async (url: string, forceOpenApi = false) => {
    if (!forceOpenApi && !isKnownRabbyOrDeBankUrl(url)) return;
    const classification = classifyRemoteDataEndpoint(url);
    if (!classification || classification === 'removed') return;
    const capability = classification.find((item) => this.isAllowed(item));
    if (!capability) return;
    const hostname = new URL(url, 'https://hippo.invalid').hostname;
    const now = Date.now();
    const previous = this.policy.lastContacts[capability];
    if (previous?.hostname === hostname && now - previous.at < 60_000) {
      return;
    }
    this.policy = {
      ...this.policy,
      lastContacts: {
        ...this.policy.lastContacts,
        [capability]: { capability, hostname, at: now },
      },
    };
    await browser.storage.local.set({
      [REMOTE_DATA_POLICY_STORAGE_KEY]: this.policy,
    });
  };

  clearContactLog = async () => {
    this.policy = { ...this.policy, lastContacts: {}, updatedAt: Date.now() };
    await browser.storage.local.set({
      [REMOTE_DATA_POLICY_STORAGE_KEY]: this.policy,
    });
    return this.getPolicy();
  };

  assertRequestAllowed = (url: string, forceOpenApi = false) => {
    if (!forceOpenApi && !isKnownRabbyOrDeBankUrl(url)) return;

    const classification = classifyRemoteDataEndpoint(url);
    if (classification === 'removed') {
      throw new RemoteDataPolicyError(
        'REMOTE_FEATURE_REMOVED',
        'This upstream feature has been removed from Hippo Wallet'
      );
    }
    if (!classification) {
      throw new RemoteDataPolicyError(
        'REMOTE_DATA_UNCLASSIFIED',
        'Unclassified Rabby/DeBank request blocked by Hippo Wallet'
      );
    }
    if (!this.policy.configured) {
      throw new RemoteDataPolicyError(
        'REMOTE_DATA_DISABLED',
        'Rabby/DeBank access has not been configured'
      );
    }
    const allowed = classification.some((capability) =>
      this.isAllowed(capability)
    );
    if (!allowed) {
      throw new RemoteDataPolicyError(
        'REMOTE_DATA_DISABLED',
        `Rabby/DeBank access is disabled for ${classification.join(', ')}`,
        classification[0]
      );
    }
  };

  private updateNetworkRules = async () => {
    const dnr = (globalThis as any).chrome?.declarativeNetRequest;
    if (!dnr?.updateDynamicRules) return;

    const anyApiEnabled =
      !this.locked &&
      REMOTE_DATA_CAPABILITIES.some(
        (capability) => this.policy.capabilities[capability]
      );
    const remoteMediaEnabled =
      !this.locked &&
      ['portfolio', 'nft', 'dapps'].some(
        (capability) =>
          this.policy.capabilities[capability as RemoteDataCapability]
      );
    const configured = this.policy.configured && !this.locked;
    const addRules: any[] = [];
    if (!configured || !anyApiEnabled) {
      addRules.push({
        id: REMOTE_DATA_BLOCK_RULE_ID,
        priority: 1,
        action: { type: 'block' },
        condition: { regexFilter: REMOTE_PROVIDER_REGEX },
      });
    } else if (!remoteMediaEnabled) {
      addRules.push({
        id: REMOTE_MEDIA_BLOCK_RULE_ID,
        priority: 1,
        action: { type: 'block' },
        condition: {
          regexFilter: REMOTE_PROVIDER_REGEX,
          resourceTypes: ['image', 'media', 'font'],
        },
      });
    }
    await dnr.updateDynamicRules({
      removeRuleIds: [REMOTE_DATA_BLOCK_RULE_ID, REMOTE_MEDIA_BLOCK_RULE_ID],
      addRules,
    });
  };
}

export default new RemoteDataPolicyService();
