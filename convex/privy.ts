"use node";

import { Buffer } from "buffer";
globalThis.Buffer = Buffer;

import { ConvexError, v } from "convex/values";
import { AuthorizationContext, PrivyClient, User } from "@privy-io/node";
import { action, ActionCtx } from "./_generated/server";
import { PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_SIGNER_PRIVATE_KEY } from "./convexEnv";
import { api, internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";

export interface PrivyWallet {
  id: string | null;
  address: string;
  chain_id: string;
  chain_type: "solana";
  connector_type: "embedded";
  delegated: boolean;
  first_verified_at: number | null;
  imported: boolean;
  latest_verified_at: number | null;
  public_key: string;
  recovery_method: "privy" | "user-passcode" | "google-drive" | "icloud" | "recovery-encryption-key" | "privy-v2";
  type: "wallet";
  verified_at: number;
  wallet_client: "privy";
  wallet_client_type: "privy";
  wallet_index: number;
}
export const CHAIN_ID_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

export const privy = new PrivyClient({
  appId: PRIVY_APP_ID!,
  appSecret: PRIVY_APP_SECRET!,
});
export const privyAuthContext: AuthorizationContext = {
  authorization_private_keys: [PRIVY_SIGNER_PRIVATE_KEY!],
};

export const authenticate = action({
  args: {
    token: v.string(),
    address: v.string(),
    privyUserId: v.string(),
  },
  handler: async (
    ctx,
    args
  ): Promise<{ success: true; user: Doc<"users">; wasCreated: boolean } | { success: false; error: string }> => {
    try {
      const { privyUser } = await authenticateUser({ ctx });

      const { user, wasCreated } = await ctx.runMutation(internal.tables.users.mutations.getOrCreateUser, {
        privyUserId: privyUser.id,
        address: args.address,
      });

      return { success: true, user, wasCreated };
    } catch (err) {
      console.error("Privy auth error:", err);
      return { success: false, error: "Server error" };
    }
  },
});

export async function authenticateUser({ ctx }: { ctx: ActionCtx }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("unauthorized");

  const [user, privyUser] = await Promise.all([
    ctx.runQuery(api.tables.users.get.getUserByPrivyUserId, {
      privyUserId: identity.subject,
    }),
    privy.users()._get(identity.subject),
  ]);

  const embeddedWallet = privyUser.linked_accounts.find(isSolanaEmbeddedWallet);

  if (!embeddedWallet) throw new ConvexError("User does not have a Privy embedded wallet");

  return {
    user,
    privyUser,
    userWallet: embeddedWallet,
  };
}

function isSolanaEmbeddedWallet(acc: User["linked_accounts"][number]): acc is PrivyWallet {
  return (
    acc.type === "wallet" &&
    acc.chain_type === "solana" &&
    acc.connector_type === "embedded" &&
    acc.wallet_client_type === "privy"
  );
}
