export const REMOTE_DATA_POLICY_VERSION = 1 as const;

export const REMOTE_DATA_CAPABILITIES = [
  'portfolio',
  'history',
  'nft',
  'signing',
  'approvals',
  'security',
  'dapps',
  'feedback',
] as const;

export type RemoteDataCapability = typeof REMOTE_DATA_CAPABILITIES[number];

export type RemoteDataCapabilityState = Record<RemoteDataCapability, boolean>;

export interface RemoteDataContact {
  capability: RemoteDataCapability;
  hostname: string;
  at: number;
}

export interface RemoteDataPolicy {
  version: typeof REMOTE_DATA_POLICY_VERSION;
  configured: boolean;
  capabilities: RemoteDataCapabilityState;
  lastContacts: Partial<Record<RemoteDataCapability, RemoteDataContact>>;
  updatedAt: number | null;
}

export const EMPTY_REMOTE_DATA_CAPABILITIES: RemoteDataCapabilityState = {
  portfolio: false,
  history: false,
  nft: false,
  signing: false,
  approvals: false,
  security: false,
  dapps: false,
  feedback: false,
};
