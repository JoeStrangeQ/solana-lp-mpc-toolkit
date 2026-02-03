import { Id } from "../_generated/dataModel";
import { ActivityType } from "../schema/activities";

export type ActionSuccessPayloads = {
  create_position: {
    activityId: Id<"activities">;
    positionPubkey: string;
    createPositionTxId: string;
  };
  transfer: { activityId: Id<"activities">; txId: string };
  close_position: { activityId: Id<"activities">; closedPositionId: string };
  claim_fees: { activityId: Id<"activities">; claimFeeTxId: string };

  // fee_claim: { activityId: Id<"activities">; claimedAmount: number };
  // withdraw_liquidity: { activityId: Id<"activities">; withdrawnAmount: number };
  // add_liquidity: { activityId: Id<"activities">; addedAmount: number };
};

export type ActionRes<T extends ActivityType> =
  | {
      status: "success";
      result: ActionSuccessPayloads[T];
    }
  | {
      status: "failed";
      errorMsg: string;
    };
