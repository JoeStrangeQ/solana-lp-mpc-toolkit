/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as actions_dlmmPosition_createPositionV2 from "../actions/dlmmPosition/createPositionV2.js";
import type * as actions_dlmmPosition_removeLiquidityV2 from "../actions/dlmmPosition/removeLiquidityV2.js";
import type * as actions_fetch_dlmm from "../actions/fetch/dlmm.js";
import type * as actions_fetch_tokenMetadata from "../actions/fetch/tokenMetadata.js";
import type * as actions_fetch_tokenPrices from "../actions/fetch/tokenPrices.js";
import type * as actions_fetch_walletBalances from "../actions/fetch/walletBalances.js";
import type * as convexEnv from "../convexEnv.js";
import type * as helpers_buildJupiterSwapTransaction from "../helpers/buildJupiterSwapTransaction.js";
import type * as helpers_buildTitanSwapTransaction from "../helpers/buildTitanSwapTransaction.js";
import type * as helpers_buildTransferTokenTransaction from "../helpers/buildTransferTokenTransaction.js";
import type * as helpers_executeSwapsWithNozomi from "../helpers/executeSwapsWithNozomi.js";
import type * as helpers_jito from "../helpers/jito.js";
import type * as helpers_normalizeServerSwapQuote from "../helpers/normalizeServerSwapQuote.js";
import type * as helpers_nozomi from "../helpers/nozomi.js";
import type * as helpers_parseTransaction from "../helpers/parseTransaction.js";
import type * as helpers_simulateAndGetTokensBalance from "../helpers/simulateAndGetTokensBalance.js";
import type * as helpers_transferMnMFees from "../helpers/transferMnMFees.js";
import type * as privy from "../privy.js";
import type * as schema_activities from "../schema/activities.js";
import type * as schema_positions from "../schema/positions.js";
import type * as services_jito from "../services/jito.js";
import type * as services_jupiter from "../services/jupiter.js";
import type * as services_meteora from "../services/meteora.js";
import type * as services_mnmServer from "../services/mnmServer.js";
import type * as services_solana from "../services/solana.js";
import type * as tables_activities_get from "../tables/activities/get.js";
import type * as tables_activities_mutations from "../tables/activities/mutations.js";
import type * as tables_positions_get from "../tables/positions/get.js";
import type * as tables_positions_mutations from "../tables/positions/mutations.js";
import type * as tables_users_get from "../tables/users/get.js";
import type * as tables_users_mutations from "../tables/users/mutations.js";
import type * as types_actionResults from "../types/actionResults.js";
import type * as types_solanaRpcValidations from "../types/solanaRpcValidations.js";
import type * as types_titanSwapQuote from "../types/titanSwapQuote.js";
import type * as utils_amounts from "../utils/amounts.js";
import type * as utils_meteora from "../utils/meteora.js";
import type * as utils_retry from "../utils/retry.js";
import type * as utils_solana from "../utils/solana.js";
import type * as utils_timeframe from "../utils/timeframe.js";
import type * as utils_tryCatch from "../utils/tryCatch.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "actions/dlmmPosition/createPositionV2": typeof actions_dlmmPosition_createPositionV2;
  "actions/dlmmPosition/removeLiquidityV2": typeof actions_dlmmPosition_removeLiquidityV2;
  "actions/fetch/dlmm": typeof actions_fetch_dlmm;
  "actions/fetch/tokenMetadata": typeof actions_fetch_tokenMetadata;
  "actions/fetch/tokenPrices": typeof actions_fetch_tokenPrices;
  "actions/fetch/walletBalances": typeof actions_fetch_walletBalances;
  convexEnv: typeof convexEnv;
  "helpers/buildJupiterSwapTransaction": typeof helpers_buildJupiterSwapTransaction;
  "helpers/buildTitanSwapTransaction": typeof helpers_buildTitanSwapTransaction;
  "helpers/buildTransferTokenTransaction": typeof helpers_buildTransferTokenTransaction;
  "helpers/executeSwapsWithNozomi": typeof helpers_executeSwapsWithNozomi;
  "helpers/jito": typeof helpers_jito;
  "helpers/normalizeServerSwapQuote": typeof helpers_normalizeServerSwapQuote;
  "helpers/nozomi": typeof helpers_nozomi;
  "helpers/parseTransaction": typeof helpers_parseTransaction;
  "helpers/simulateAndGetTokensBalance": typeof helpers_simulateAndGetTokensBalance;
  "helpers/transferMnMFees": typeof helpers_transferMnMFees;
  privy: typeof privy;
  "schema/activities": typeof schema_activities;
  "schema/positions": typeof schema_positions;
  "services/jito": typeof services_jito;
  "services/jupiter": typeof services_jupiter;
  "services/meteora": typeof services_meteora;
  "services/mnmServer": typeof services_mnmServer;
  "services/solana": typeof services_solana;
  "tables/activities/get": typeof tables_activities_get;
  "tables/activities/mutations": typeof tables_activities_mutations;
  "tables/positions/get": typeof tables_positions_get;
  "tables/positions/mutations": typeof tables_positions_mutations;
  "tables/users/get": typeof tables_users_get;
  "tables/users/mutations": typeof tables_users_mutations;
  "types/actionResults": typeof types_actionResults;
  "types/solanaRpcValidations": typeof types_solanaRpcValidations;
  "types/titanSwapQuote": typeof types_titanSwapQuote;
  "utils/amounts": typeof utils_amounts;
  "utils/meteora": typeof utils_meteora;
  "utils/retry": typeof utils_retry;
  "utils/solana": typeof utils_solana;
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
