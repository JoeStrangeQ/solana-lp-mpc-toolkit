"use node";

import { Buffer } from "buffer";
globalThis.Buffer = Buffer;

import { ConvexError, Infer, v } from "convex/values";
import { AuthorizationContext, PrivyClient, User } from "@privy-io/node";
import { action, ActionCtx, MutationCtx } from "./_generated/server";
import { PRIVY_APP_ID, PRIVY_APP_SECRET, PRIVY_SIGNER_PRIVATE_KEY } from "./convexEnv";
import { api, internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";

export const vPrivyWallet = v.object({
  id: v.union(v.string(), v.null()),
  address: v.string(),

  chain_id: v.string(),
  chain_type: v.literal("solana"),

  connector_type: v.literal("embedded"),

  delegated: v.boolean(),

  first_verified_at: v.union(v.number(), v.null()),
  imported: v.boolean(),
  latest_verified_at: v.union(v.number(), v.null()),

  public_key: v.union(v.string(), v.null()), // null when user didn't signed anything yet

  recovery_method: v.union(
    v.literal("privy"),
    v.literal("user-passcode"),
    v.literal("google-drive"),
    v.literal("icloud"),
    v.literal("recovery-encryption-key"),
    v.literal("privy-v2")
  ),

  type: v.literal("wallet"),

  verified_at: v.number(),

  wallet_client: v.literal("privy"),
  wallet_client_type: v.literal("privy"),

  wallet_index: v.number(),
});

//typed like privy
export const vPrivyWalletRaw = v.object({
  ...vPrivyWallet.fields,
  public_key: v.string(),
});

export type PrivyWallet = Infer<typeof vPrivyWallet>;

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

export async function authenticateUser({ ctx }: { ctx: ActionCtx | MutationCtx }): Promise<{
  user: Doc<"users"> | null;
  privyUser: User;
  userWallet: PrivyWallet;
}> {
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
    userWallet: { ...embeddedWallet, public_key: embeddedWallet.public_key ?? "" },
  };
}

export async function authenticateWithUserId({ ctx, userId }: { ctx: ActionCtx; userId: Id<"users"> }) {
  //IMPORTANT : call only from internal actions/mutations
  const user = await ctx.runQuery(api.tables.users.get.getUserById, {
    id: userId,
  });

  if (!user?.privyUserId) throw new Error(`Couldn't find privy id for user ${userId}`);
  const privyUser = await privy.users()._get(user.privyUserId);
  const embeddedWallet = privyUser.linked_accounts.find(isSolanaEmbeddedWallet);
  if (!embeddedWallet) throw new ConvexError("User does not have a Privy embedded wallet");

  return {
    user,
    privyUser,
    userWallet: { ...embeddedWallet, public_key: embeddedWallet.public_key ?? "" },
  };
}

function isSolanaEmbeddedWallet(acc: User["linked_accounts"][number]): acc is Infer<typeof vPrivyWalletRaw> {
  return (
    acc.type === "wallet" &&
    acc.chain_type === "solana" &&
    acc.connector_type === "embedded" &&
    acc.wallet_client_type === "privy"
  );
}
