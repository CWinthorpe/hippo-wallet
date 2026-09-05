import type { ContactBookStore } from '@/background/service/contactBook';
import type { CurrencyStore } from '@/background/service/currency';
import type { CustomRPCServiceStore } from '@/background/service/rpc';
import type { WhitelistStore } from '@/background/service/whitelist';
import type { PublicOpenapiStore } from '@/services/openapi';

export type PersistedStoreMap = {
  contactBook: ContactBookStore;
  currency: CurrencyStore;
  openapi: PublicOpenapiStore;
  rpc: CustomRPCServiceStore;
  whitelist: WhitelistStore;
};

export type PersistedStoreKey = keyof PersistedStoreMap;

export type PersistedStorePatch<Key extends PersistedStoreKey> = Partial<
  PersistedStoreMap[Key]
>;

export type PersistedStoreSnapshot<Key extends PersistedStoreKey> = {
  origin: string;
  revision: number;
  state: PersistedStoreMap[Key];
};
