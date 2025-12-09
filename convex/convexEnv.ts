import { Connection } from "@solana/web3.js";

export const PRIVY_APP_ID = process.env.PRIVY_APP_ID as string;
export const PRIVY_SIGNER_PRIVATE_KEY = process.env.PRIVY_SIGNER_PRIVATE_KEY;
export const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET as string;

export const JUPITER_API_KEY = process.env.JUPITER_API_KEY as string;

export const HELIUS_API_KEY = process.env.HELIUS_API_KEY as string;
export const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

export const RPC_URL = process.env.RPC_URL as string;
export const JITO_UUID = process.env.JITO_UUID as string;
export const NOZOMI_API_KEY = process.env.NOZOMI_API_KEY as string;

/**
 * ✅ Auto-select RPC based on environment
 */
const isProd = process.env.NODE_ENV === "production";

export const ACTIVE_RPC_URL = isProd ? RPC_URL : HELIUS_RPC_URL;

/**
 * ✅ Hard guard so Convex NEVER boots with an invalid RPC
 */
if (!ACTIVE_RPC_URL || !ACTIVE_RPC_URL.startsWith("http")) {
  throw new Error(
    `❌ Invalid RPC configuration:
NODE_ENV=${process.env.NODE_ENV}
RPC_URL=${RPC_URL}
HELIUS_RPC_URL=${HELIUS_RPC_URL}`
  );
}

export const connection = new Connection(ACTIVE_RPC_URL);
