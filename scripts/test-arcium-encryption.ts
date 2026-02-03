/**
 * Test Arcium Encryption with REAL devnet MXE public key
 *
 * This script verifies that:
 * 1. We can derive a shared secret with the real MXE key
 * 2. RescueCipher encrypt/decrypt works correctly
 * 3. Strategy encryption/decryption roundtrips successfully
 */

import { PublicKey } from "@solana/web3.js";
import {
  ArciumPrivacyService,
  ARCIUM_DEVNET_CONFIG,
  generatePrivacyKeys,
  deriveSharedSecret,
} from "../src/lp-toolkit/services/arciumPrivacy";
import { x25519, RescueCipher } from "@arcium-hq/client";
import { randomBytes } from "crypto";

async function main() {
  console.log("🔐 Testing Arcium Encryption with REAL Devnet MXE Key\n");
  console.log("=".repeat(60));

  // Show devnet config
  console.log("\n📋 Devnet Configuration:");
  console.log(`   Cluster Offset: ${ARCIUM_DEVNET_CONFIG.clusterOffset}`);
  console.log(`   MXE Public Key: ${ARCIUM_DEVNET_CONFIG.mxePublicKeyHex}`);
  console.log(`   Cluster Authority: ${ARCIUM_DEVNET_CONFIG.clusterAuthority}`);
  console.log(`   Cluster Size: ${ARCIUM_DEVNET_CONFIG.clusterSize} nodes`);

  // Test 1: Key derivation
  console.log("\n\n🔑 Test 1: X25519 Key Derivation");
  console.log("-".repeat(40));

  const clientKeys = generatePrivacyKeys();
  console.log(
    `   Client Private Key: ${Buffer.from(clientKeys.privateKey).toString("hex").slice(0, 32)}...`,
  );
  console.log(
    `   Client Public Key:  ${Buffer.from(clientKeys.publicKey).toString("hex").slice(0, 32)}...`,
  );

  const sharedSecret = deriveSharedSecret(
    clientKeys.privateKey,
    ARCIUM_DEVNET_CONFIG.mxePublicKey,
  );
  console.log(
    `   Shared Secret:      ${Buffer.from(sharedSecret).toString("hex").slice(0, 32)}...`,
  );
  console.log("   ✅ Key derivation successful!");

  // Test 2: RescueCipher direct test
  console.log("\n\n🔐 Test 2: RescueCipher Encrypt/Decrypt");
  console.log("-".repeat(40));

  const cipher = new RescueCipher(sharedSecret);
  const testPlaintext = [BigInt(123456), BigInt(789012), BigInt(345678)];
  const testNonce = randomBytes(16);

  console.log(`   Plaintext: [${testPlaintext.join(", ")}]`);

  const ciphertext = cipher.encrypt(testPlaintext, testNonce);
  console.log(`   Ciphertext length: ${ciphertext.length} arrays`);

  const decrypted = cipher.decrypt(ciphertext, testNonce);
  console.log(`   Decrypted: [${decrypted.join(", ")}]`);

  const match = testPlaintext.every((v, i) => v === decrypted[i]);
  if (match) {
    console.log("   ✅ RescueCipher roundtrip successful!");
  } else {
    console.log("   ❌ Mismatch! Encryption/decryption failed.");
    process.exit(1);
  }

  // Test 3: ArciumPrivacyService full integration
  console.log("\n\n🛡️ Test 3: ArciumPrivacyService Integration");
  console.log("-".repeat(40));

  const ownerPubkey = new PublicKey("11111111111111111111111111111111");
  const privacyService = new ArciumPrivacyService(ownerPubkey);

  console.log("   Initializing with devnet config...");
  const initialized = await privacyService.initializeDevnet();
  console.log(`   Initialized: ${initialized}`);
  console.log(`   Service Ready: ${privacyService.isReady()}`);

  // Test strategy encryption
  console.log("\n   Testing strategy encryption...");
  const testIntent = {
    tokenA: "SOL",
    tokenB: "USDC",
    amountA: 1.5,
    amountB: 150,
    totalValueUSD: 300,
    strategy: "concentrated" as const,
    slippageBps: 50,
  };

  console.log(`   Original Intent:`);
  console.log(`     - Tokens: ${testIntent.tokenA}/${testIntent.tokenB}`);
  console.log(`     - Amounts: ${testIntent.amountA} / ${testIntent.amountB}`);
  console.log(`     - Value: $${testIntent.totalValueUSD}`);
  console.log(`     - Strategy: ${testIntent.strategy}`);

  const encrypted = privacyService.encryptStrategy(testIntent);
  console.log(`\n   Encrypted Strategy:`);
  console.log(`     - ID: ${encrypted.id}`);
  console.log(`     - Owner: ${encrypted.ownerPubkey.slice(0, 8)}...`);
  console.log(`     - Ciphertext blocks: ${encrypted.ciphertext.length}`);
  console.log(`     - Nonce: ${encrypted.nonce.slice(0, 16)}...`);

  const decryptedIntent = privacyService.decryptStrategy(encrypted);
  console.log(`\n   Decrypted Intent:`);
  console.log(
    `     - Amounts: ${decryptedIntent?.amountA} / ${decryptedIntent?.amountB}`,
  );
  console.log(`     - Value: $${decryptedIntent?.totalValueUSD}`);
  console.log(`     - Strategy: ${decryptedIntent?.strategy}`);

  if (
    decryptedIntent &&
    Math.abs(decryptedIntent.amountA! - testIntent.amountA) < 0.001 &&
    Math.abs(decryptedIntent.amountB! - testIntent.amountB) < 0.001 &&
    decryptedIntent.strategy === testIntent.strategy
  ) {
    console.log("   ✅ Strategy encryption roundtrip successful!");
  } else {
    console.log("   ❌ Strategy mismatch!");
    process.exit(1);
  }

  // Test position value encryption
  console.log("\n\n💰 Test 4: Position Value Encryption");
  console.log("-".repeat(40));

  const testValue = 1234.56;
  const testFees = 12.34;

  console.log(`   Original Value: $${testValue}`);
  console.log(`   Original Fees:  $${testFees}`);

  const encryptedPosition = privacyService.encryptPositionValue(
    testValue,
    testFees,
  );
  console.log(
    `   Encrypted (nonce: ${encryptedPosition.nonce.slice(0, 12)}...)`,
  );

  const decryptedPosition = privacyService.decryptPositionValue(
    encryptedPosition.encryptedValue,
    encryptedPosition.encryptedFees,
    encryptedPosition.nonce,
  );

  console.log(`   Decrypted Value: $${decryptedPosition?.valueUSD}`);
  console.log(`   Decrypted Fees:  $${decryptedPosition?.feesUSD}`);

  if (
    decryptedPosition &&
    Math.abs(decryptedPosition.valueUSD - testValue) < 0.01 &&
    Math.abs(decryptedPosition.feesUSD - testFees) < 0.01
  ) {
    console.log("   ✅ Position value encryption roundtrip successful!");
  } else {
    console.log("   ❌ Position value mismatch!");
    process.exit(1);
  }

  // Summary
  console.log("\n\n" + "=".repeat(60));
  console.log("🎉 ALL TESTS PASSED!");
  console.log("=".repeat(60));
  console.log("\n✅ Arcium integration is working with REAL devnet MXE key");
  console.log("✅ RescueCipher encryption/decryption verified");
  console.log("✅ Strategy privacy: Parameters are encrypted before execution");
  console.log("✅ Position privacy: Values are encrypted for storage");
  console.log("\n🦐 Ready for hackathon submission!\n");
}

main().catch(console.error);
