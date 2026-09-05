import { INITIAL_OPENAPI_URL } from '@/constant';
import { z } from 'zod';

export const openapiStoreSchema = z.object({
  host: z.string().default(INITIAL_OPENAPI_URL),
  apiKey: z.string().nullable().default(null),
  apiTime: z.number().nullable().default(null),
});

export type OpenapiServiceStore = z.output<typeof openapiStoreSchema>;

/**
 * OpenAPI configuration shared between the background and extension pages.
 * The background remains the persisted source of truth for these values.
 *
 * Hippo privacy policy: the X-API-Key installation identifier is never
 * generated and never crosses into extension pages, so only `host` is
 * public here.
 */
export const PUBLIC_OPENAPI_KEYS = ['host'] as const;

export type PublicOpenapiStore = Pick<
  OpenapiServiceStore,
  typeof PUBLIC_OPENAPI_KEYS[number]
>;

export const createOpenapiStoreTemplate = (): OpenapiServiceStore =>
  openapiStoreSchema.parse({});

export const pickPublicOpenapiStore = <T extends Partial<OpenapiServiceStore>>(
  store: T
): Pick<T, typeof PUBLIC_OPENAPI_KEYS[number] & keyof T> =>
  Object.fromEntries(
    Object.entries(store).filter(([key]) =>
      (PUBLIC_OPENAPI_KEYS as ReadonlyArray<string>).includes(key)
    )
  ) as Pick<T, typeof PUBLIC_OPENAPI_KEYS[number] & keyof T>;

export type OpenapiClientStore = OpenapiServiceStore;
