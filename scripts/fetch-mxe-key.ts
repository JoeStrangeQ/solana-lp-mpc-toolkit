/**
 * Fetch MXE Public Key from Arcium Devnet
 *
 * This script queries the Arcium devnet cluster to get the MXE public key
 * needed for encrypting data before submission.
 */

import {
  getClusterAccAddress,
  getArciumProgram,
  getArciumProgramId,
} from "@arcium-hq/client";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, clusterApiUrl, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";

const CLUSTER_OFFSET = 456; // Recommended devnet cluster (v0.7.0)

async function main() {
  console.log("🔐 Fetching Arcium MXE Public Key from Devnet\n");
  console.log(`Cluster Offset: ${CLUSTER_OFFSET}`);

  // Setup connection
  const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed",
  );
  console.log("Connected to Solana devnet\n");

  // Load wallet from file
  const keypairPath = `${os.homedir()}/.config/solana/id.json`;
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
  const wallet = new anchor.Wallet(keypair);

  // Create provider
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Get Arcium program
  const arciumProgramId = getArciumProgramId();
  console.log(`Arcium Program ID: ${arciumProgramId.toBase58()}`);

  // Get cluster account address
  const clusterAccAddress = getClusterAccAddress(CLUSTER_OFFSET);
  console.log(
    `Cluster Account (offset ${CLUSTER_OFFSET}): ${clusterAccAddress.toBase58()}`,
  );

  // Fetch cluster account data
  console.log("\nFetching cluster account data...");
  const clusterAccountInfo = await connection.getAccountInfo(clusterAccAddress);

  if (!clusterAccountInfo) {
    console.error(
      "❌ Cluster account not found! The cluster may not be initialized.",
    );
    console.log("\nTry a different cluster offset:");
    console.log("  - 123 (v0.5.4)");
    console.log("  - 456 (v0.7.0)");
    process.exit(1);
  }

  console.log(
    `✅ Cluster account found (${clusterAccountInfo.data.length} bytes)`,
  );
  console.log(`   Owner: ${clusterAccountInfo.owner.toBase58()}`);

  // Try to decode the cluster account using the Arcium program
  try {
    const arciumProgram = await getArciumProgram(provider);

    // The cluster account contains utility_pubkeys which includes the MXE x25519 key
    // According to the SDK, the MXE public key is at a specific offset in the account data
    const data = clusterAccountInfo.data;

    // Log raw data info for debugging
    console.log(`\n📊 Account Data Analysis:`);
    console.log(`   Total bytes: ${data.length}`);

    // The x25519 public key is 32 bytes
    // Based on Arcium's account structure, let's look for it
    // utility_pubkeys is typically at offset 46 according to Stack Exchange post

    const UTILITY_PUBKEYS_OFFSET = 46;
    const X25519_KEY_LENGTH = 32;

    if (data.length > UTILITY_PUBKEYS_OFFSET + X25519_KEY_LENGTH) {
      const potentialKey = data.slice(
        UTILITY_PUBKEYS_OFFSET,
        UTILITY_PUBKEYS_OFFSET + X25519_KEY_LENGTH,
      );
      const isZero = potentialKey.every((b: number) => b === 0);

      console.log(
        `\n🔑 Potential MXE Public Key (offset ${UTILITY_PUBKEYS_OFFSET}):`,
      );
      console.log(`   Hex: ${Buffer.from(potentialKey).toString("hex")}`);
      console.log(`   Is Zero: ${isZero}`);

      if (isZero) {
        console.log(
          "\n⚠️  Key is all zeros - DKG may not be complete for this cluster.",
        );
        console.log("   This is a known issue on devnet. Try:");
        console.log("   1. Wait for DKG to complete");
        console.log("   2. Try a different cluster offset");
        console.log("   3. Use localnet for development");
      } else {
        console.log("\n✅ MXE Public Key found!");
        console.log(`\nExport for use in code:`);
        console.log(
          `const MXE_PUBLIC_KEY = new Uint8Array([${Array.from(potentialKey).join(", ")}]);`,
        );

        // Save to a file for easy import
        const keyData = {
          clusterOffset: CLUSTER_OFFSET,
          mxePublicKey: Buffer.from(potentialKey).toString("hex"),
          mxePublicKeyArray: Array.from(potentialKey),
          fetchedAt: new Date().toISOString(),
        };

        fs.writeFileSync(
          "./arcium-devnet-keys.json",
          JSON.stringify(keyData, null, 2),
        );
        console.log(`\n📁 Saved to arcium-devnet-keys.json`);
      }
    }

    // Also try to fetch via the program's account decoder
    console.log("\n📋 Attempting to decode via Arcium program...");
    // @ts-ignore - accessing internal structure
    if (arciumProgram.account && arciumProgram.account.cluster) {
      const clusterData =
        await arciumProgram.account.cluster.fetch(clusterAccAddress);
      console.log("Cluster data:", JSON.stringify(clusterData, null, 2));
    }
  } catch (e) {
    console.log(`\n⚠️  Could not decode cluster account: ${e}`);
  }

  console.log("\n✨ Done!");
}

main().catch(console.error);
