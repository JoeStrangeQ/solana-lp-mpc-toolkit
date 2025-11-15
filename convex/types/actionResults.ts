// import { Id } from "../_generated/dataModel";
// import { ActivityType } from "./activities";

// export type ActionSuccessPayloads = {
//   create_position: { activityId: Id<"activities">; positionPubkey: string };
//   transfer: { activityId: Id<"activities">; txId: string };
//   fee_claim: { activityId: Id<"activities">; claimedAmount: number };
//   withdraw_liquidity: { activityId: Id<"activities">; withdrawnAmount: number };
//   add_liquidity: { activityId: Id<"activities">; addedAmount: number };
//   close_position: { activityId: Id<"activities">; closedPositionId: string };
// };

// export type ActionRes<T extends ActivityType>
export type ActionRes =
  | {
      status: "success";
      result: {};
    }
  | {
      status: "failed";
      errorMsg: string;
    };
