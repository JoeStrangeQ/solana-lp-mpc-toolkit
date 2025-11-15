/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_dlmmPosition_createPosition from "../actions/dlmmPosition/createPosition.js";
import type * as actions_fetch_dlmm from "../actions/fetch/dlmm.js";
import type * as actions_fetch_tokenMetadata from "../actions/fetch/tokenMetadata.js";
import type * as actions_fetch_tokenPrices from "../actions/fetch/tokenPrices.js";
import type * as actions_fetch_walletBalances from "../actions/fetch/walletBalances.js";
import type * as convexEnv from "../convexEnv.js";
import type * as helpers_buildTitanSwapTransaction from "../helpers/buildTitanSwapTransaction.js";
import type * as helpers_jito from "../helpers/jito.js";
import type * as helpers_normalizeServerSwapQuote from "../helpers/normalizeServerSwapQuote.js";
import type * as privy from "../privy.js";
import type * as schema_dlmmPosition from "../schema/dlmmPosition.js";
import type * as services_jito from "../services/jito.js";
import type * as services_jupiter from "../services/jupiter.js";
import type * as services_meteora from "../services/meteora.js";
import type * as services_mnmServer from "../services/mnmServer.js";
import type * as tables_users_get from "../tables/users/get.js";
import type * as tables_users_mutations from "../tables/users/mutations.js";
import type * as types_actionResults from "../types/actionResults.js";
import type * as types_titanSwapQuote from "../types/titanSwapQuote.js";
import type * as utils_address from "../utils/address.js";
import type * as utils_amounts from "../utils/amounts.js";
import type * as utils_meteora from "../utils/meteora.js";
import type * as utils_timeframe from "../utils/timeframe.js";
import type * as utils_tryCatch from "../utils/tryCatch.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/dlmmPosition/createPosition": typeof actions_dlmmPosition_createPosition;
  "actions/fetch/dlmm": typeof actions_fetch_dlmm;
  "actions/fetch/tokenMetadata": typeof actions_fetch_tokenMetadata;
  "actions/fetch/tokenPrices": typeof actions_fetch_tokenPrices;
  "actions/fetch/walletBalances": typeof actions_fetch_walletBalances;
  convexEnv: typeof convexEnv;
  "helpers/buildTitanSwapTransaction": typeof helpers_buildTitanSwapTransaction;
  "helpers/jito": typeof helpers_jito;
  "helpers/normalizeServerSwapQuote": typeof helpers_normalizeServerSwapQuote;
  privy: typeof privy;
  "schema/dlmmPosition": typeof schema_dlmmPosition;
  "services/jito": typeof services_jito;
  "services/jupiter": typeof services_jupiter;
  "services/meteora": typeof services_meteora;
  "services/mnmServer": typeof services_mnmServer;
  "tables/users/get": typeof tables_users_get;
  "tables/users/mutations": typeof tables_users_mutations;
  "types/actionResults": typeof types_actionResults;
  "types/titanSwapQuote": typeof types_titanSwapQuote;
  "utils/address": typeof utils_address;
  "utils/amounts": typeof utils_amounts;
  "utils/meteora": typeof utils_meteora;
  "utils/timeframe": typeof utils_timeframe;
  "utils/tryCatch": typeof utils_tryCatch;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  actionCache: {
    crons: {
      purge: FunctionReference<
        "mutation",
        "internal",
        { expiresAt?: number },
        null
      >;
    };
    lib: {
      get: FunctionReference<
        "query",
        "internal",
        { args: any; name: string; ttl: number | null },
        { kind: "hit"; value: any } | { expiredEntry?: string; kind: "miss" }
      >;
      put: FunctionReference<
        "mutation",
        "internal",
        {
          args: any;
          expiredEntry?: string;
          name: string;
          ttl: number | null;
          value: any;
        },
        { cacheHit: boolean; deletedExpiredEntry: boolean }
      >;
      remove: FunctionReference<
        "mutation",
        "internal",
        { args: any; name: string },
        null
      >;
      removeAll: FunctionReference<
        "mutation",
        "internal",
        { batchSize?: number; before?: number; name?: string },
        null
      >;
    };
  };
};
