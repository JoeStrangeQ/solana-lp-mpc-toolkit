import { Connection } from "@solana/web3.js";

export const PRIVY_APP_ID = process.env.PRIVY_APP_ID as string;
export const PRIVY_SIGNER_PRIVATE_KEY = process.env.PRIVY_SIGNER_PRIVATE_KEY;
export const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET as string;

export const JUPITER_API_KEY = process.env.JUPITER_API_KEY as string;

const RPC_DOMAIN = process.env.RPC_DOMAIN as string;
export const RPC_URL = `https://${RPC_DOMAIN}`;
export const JITO_UUID = process.env.JITO_UUID as string;
export const NOZOMI_API_KEY = process.env.NOZOMI_API_KEY as string;

export const connection = new Connection(RPC_URL);
