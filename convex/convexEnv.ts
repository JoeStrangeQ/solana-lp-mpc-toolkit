import { Connection } from "@solana/web3.js";

export const PRIVY_APP_ID = process.env.PRIVY_APP_ID as string;
export const PRIVY_SIGNER_PRIVATE_KEY = process.env.PRIVY_SIGNER_PRIVATE_KEY;
export const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET as string;

export const JUPITER_API_KEY = process.env.JUPITER_API_KEY as string;

export const AI_API_KEY = process.env.AI_API_KEY as string;

export const HELIUS_API_KEY = process.env.HELIUS_API_KEY as string;
export const RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
export const connection = new Connection(RPC_URL);
export const JITO_UUID = process.env.JITO_UUID as string;

export const NOZOMI_API_KEY = process.env.NOZOMI_API_KEY as string;
