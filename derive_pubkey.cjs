const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");

const privateKeyBase58 = process.argv[2];
if (!privateKeyBase58) {
  console.error("Usage: node derive_pubkey.cjs <base58_private_key>");
  process.exit(1);
}

try {
  // Handle different bs58 API versions
  const decode = bs58.decode || bs58.default?.decode;
  if (!decode) {
    throw new Error("bs58.decode not found");
  }
  const secretKey = decode(privateKeyBase58);
  const keypair = Keypair.fromSecretKey(secretKey);
  console.log(keypair.publicKey.toBase58());
} catch (e) {
  console.error("Error:", e.message);
  // Try alternative approach using Buffer
  try {
    const secretKey = Buffer.from(privateKeyBase58, "base64");
    const keypair = Keypair.fromSecretKey(secretKey);
    console.log(keypair.publicKey.toBase58());
  } catch (e2) {
    console.error("Alt Error:", e2.message);
    process.exit(1);
  }
}
