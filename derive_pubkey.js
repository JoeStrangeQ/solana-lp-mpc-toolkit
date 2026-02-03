const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");

const privateKeyBase58 = process.argv[2];
if (!privateKeyBase58) {
  console.error("Usage: node derive_pubkey.js <base58_private_key>");
  process.exit(1);
}

try {
  const secretKey = bs58.decode(privateKeyBase58);
  const keypair = Keypair.fromSecretKey(secretKey);
  console.log(keypair.publicKey.toBase58());
} catch (e) {
  console.error("Error:", e.message);
  process.exit(1);
}
