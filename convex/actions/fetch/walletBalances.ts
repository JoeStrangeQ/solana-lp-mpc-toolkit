"use node";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { action, ActionCtx } from "../../_generated/server";
import { v } from "convex/values";
import { connection } from "../../convexEnv";
import { Address } from "../../utils/address";
import { api } from "../../_generated/api";
import { TokenMetadata } from "../../services/jupiter";
import { AccountLayout, NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import z from "zod";

export const tokenBalanceZ = z.object({
  mint: z.string(),
  decimals: z.number(),
  name: z.string(),
  symbol: z.string(),
  logoURI: z.string().optional(),
  tokenAccount: z.string().nullable(),
  balance: z.number(),
  tokenProgram: z.string().nullable(),
  usdPrice: z.number(),
  usdBalance: z.number(),
  priceChange: z.number(),
});
export type TokenBalance = z.infer<typeof tokenBalanceZ>;

export const getWalletBalances = action({
  args: {
    address: v.string(),
  },
  handler: async (ctx, args): Promise<TokenBalance[]> => {
    const owner = new PublicKey(args.address);

    const [legacy, v2022] = await Promise.all([
      connection.getTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
      connection.getTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
    ]);

    const tokenAccounts = [...legacy.value, ...v2022.value];

    const userTokenData = tokenAccounts.reduce(
      (acc, tokenAccount) => {
        const accountData = AccountLayout.decode(tokenAccount.account.data);
        const mint = accountData.mint.toBase58();

        acc[mint] = {
          amount: tokenAccount.account.lamports,
          pubkey: tokenAccount.pubkey.toBase58(),
          owner: accountData.owner.toBase58(),
          amountRaw: accountData.amount,
        };

        return acc;
      },
      {} as Record<
        string,
        {
          amount: number;
          pubkey: string;
          owner: string;
          amountRaw: bigint;
        }
      >
    );

    const solBalance = await fetchSolBalance({
      address: args.address as Address,
      ctx,
    });

    const tokensMetadata = await ctx.runAction(api.actions.fetch.tokenMetadata.getTokensMetadataAction, {
      mints: Object.keys(userTokenData),
    });

    const mapped = tokensMetadata.map<TokenBalance | null>((asset) => {
      const mint = asset.address;
      const decoded = userTokenData[mint];
      if (!decoded) return null;

      const decimals = asset.decimals;
      const rawAmount = decoded.amountRaw;
      const balance = Number(rawAmount) / Math.pow(10, decimals);
      const usdPrice = asset.usdPrice ?? 0;
      const usdBalance = balance * usdPrice;

      const priceChange = asset.stats24h?.priceChange ?? 0;

      return {
        mint: mint,
        decimals,
        name: asset.name,
        symbol: asset.symbol,
        logoURI: asset.logoURI, // <- optional
        tokenAccount: decoded.pubkey,
        balance,
        tokenProgram: asset.tokenProgram,
        usdPrice,
        usdBalance,
        priceChange: priceChange,
      };
    });

    // Predicate compatible with parameter type because `mapped` is (TokenBalance|null)[]
    const tokens = mapped.filter((t): t is TokenBalance => t !== null && t.usdBalance >= 0.0025);

    const sortedTokenByUsdValue = tokens.sort((a: TokenBalance, b: TokenBalance) => b.usdBalance - a.usdBalance);
    return [solBalance, ...sortedTokenByUsdValue];
  },
});

async function fetchSolBalance({ address, ctx }: { address: Address; ctx: ActionCtx }) {
  const balance = await connection.getBalance(new PublicKey(address), {
    commitment: "confirmed",
  });

  const tokensMetadata: TokenMetadata[] = await ctx.runAction(api.actions.fetch.tokenMetadata.getTokensMetadataAction, {
    mints: [NATIVE_MINT.toBase58()],
  });

  const price = tokensMetadata[0].usdPrice ?? 0;
  const solBalance = balance / LAMPORTS_PER_SOL;
  const priceChange = tokensMetadata[0].stats24h?.priceChange ?? 0;
  return {
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
    name: "Solana",
    symbol: "SOL",
    logoURI:
      "https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png",
    tokenAccount: null,
    balance: solBalance,
    tokenProgram: null,
    usdPrice: price,
    usdBalance: price * solBalance,
    priceChange,
  };
}
