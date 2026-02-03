/**
 * Debug cipher format to understand encrypt/decrypt expectations
 */

import { RescueCipher, x25519 } from "@arcium-hq/client";
import { randomBytes } from "crypto";
import {
  ARCIUM_DEVNET_CONFIG,
  generatePrivacyKeys,
  deriveSharedSecret,
} from "../src/lp-toolkit/services/arciumPrivacy";

async function main() {
  console.log("🔍 Debugging RescueCipher format\n");

  // Setup cipher
  const keys = generatePrivacyKeys();
  const sharedSecret = deriveSharedSecret(
    keys.privateKey,
    ARCIUM_DEVNET_CONFIG.mxePublicKey,
  );
  const cipher = new RescueCipher(sharedSecret);

  // Test encryption
  const plaintext = [BigInt(123456), BigInt(789012)];
  const nonce = randomBytes(16);

  console.log("Input plaintext:", plaintext);
  console.log("Nonce:", nonce.toString("hex"));

  const ciphertext = cipher.encrypt(plaintext, nonce);

  console.log("\nCiphertext structure:");
  console.log("- Type:", typeof ciphertext);
  console.log("- Is Array:", Array.isArray(ciphertext));
  console.log("- Length:", ciphertext.length);
  console.log("- First element type:", typeof ciphertext[0]);
  console.log("- First element is Array:", Array.isArray(ciphertext[0]));

  if (Array.isArray(ciphertext[0])) {
    console.log("- First element length:", ciphertext[0].length);
    console.log("- First element[0] type:", typeof ciphertext[0][0]);
    console.log("- First element[0] value:", ciphertext[0][0].toString());
  }

  console.log("\nFull ciphertext (as strings):");
  ciphertext.forEach((arr, i) => {
    console.log(`  [${i}]: [${arr.map((n) => n.toString()).join(", ")}]`);
  });

  // Now test roundtrip directly
  console.log("\n--- Direct roundtrip test ---");
  const decrypted = cipher.decrypt(ciphertext, nonce);
  console.log("Decrypted:", decrypted);
  console.log(
    "Match:",
    plaintext.every((v, i) => v === decrypted[i]),
  );

  // Now test with string serialization
  console.log("\n--- String serialization test ---");
  const serialized = ciphertext.map((arr) => arr.map((n) => n.toString()));
  console.log("Serialized:", JSON.stringify(serialized));

  const deserialized = serialized.map((arr) => arr.map((s) => BigInt(s)));
  console.log("Deserialized[0][0] type:", typeof deserialized[0][0]);
  console.log("Deserialized[0][0] value:", deserialized[0][0].toString());
  console.log(
    "Deserialized same as original:",
    ciphertext.every((arr, i) => arr.every((v, j) => v === deserialized[i][j])),
  );

  console.log("\n--- Decrypt deserialized ---");
  try {
    const decrypted2 = cipher.decrypt(deserialized, nonce);
    console.log("Decrypted from deserialized:", decrypted2);
    console.log(
      "Match:",
      plaintext.every((v, i) => v === decrypted2[i]),
    );
  } catch (e) {
    console.error("Decrypt failed:", e);
  }
}

main().catch(console.error);
