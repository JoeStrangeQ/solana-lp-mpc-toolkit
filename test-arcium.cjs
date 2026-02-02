// Quick test of Arcium encryption
const nacl = require('tweetnacl');
const BN = require('bn.js');

console.log('Testing Arcium encryption locally...\n');

// Generate X25519 keypair
const keyPair = nacl.box.keyPair();
console.log('✅ Generated X25519 keypair');
console.log('   Public key:', Buffer.from(keyPair.publicKey).toString('hex').slice(0, 32) + '...');

// Simulate encryption of position data
function encryptValue(value, sharedSecret, nonce) {
  const valueBytes = new Uint8Array(32);
  const valueBN = new BN(Math.floor(value * 1e6).toString());
  const valueArray = valueBN.toArray('le', 32);
  for (let i = 0; i < valueArray.length; i++) {
    valueBytes[i] = valueArray[i];
  }
  
  // XOR encryption (simplified - real would use Rescue cipher)
  const encrypted = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    encrypted[i] = valueBytes[i] ^ sharedSecret[i % sharedSecret.length] ^ nonce[i % nonce.length];
  }
  return encrypted;
}

function decryptValue(encrypted, sharedSecret, nonce) {
  const decrypted = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    decrypted[i] = encrypted[i] ^ sharedSecret[i % sharedSecret.length] ^ nonce[i % nonce.length];
  }
  const bn = new BN(Array.from(decrypted), 'le');
  return Number(bn.toString()) / 1e6;
}

// Generate shared secret (with itself for testing)
const sharedSecret = nacl.box.before(keyPair.publicKey, keyPair.secretKey);
console.log('   Shared secret:', Buffer.from(sharedSecret).toString('hex').slice(0, 32) + '...');

// Test position data
const position = {
  collateralValueUSD: 10000,
  debtAmountUSD: 8000,
  healthFactor: 1.0625
};

const nonce = nacl.randomBytes(16);

const encryptedCollateral = encryptValue(position.collateralValueUSD, sharedSecret, nonce);
const encryptedDebt = encryptValue(position.debtAmountUSD, sharedSecret, nonce);
const encryptedHealth = encryptValue(position.healthFactor, sharedSecret, nonce);

console.log('\n✅ Encrypted position data:');
console.log('   Collateral:', Buffer.from(encryptedCollateral).toString('hex').slice(0, 32) + '...');
console.log('   Debt:', Buffer.from(encryptedDebt).toString('hex').slice(0, 32) + '...');
console.log('   Health:', Buffer.from(encryptedHealth).toString('hex').slice(0, 32) + '...');

// Decrypt to verify round-trip
const decryptedCollateral = decryptValue(encryptedCollateral, sharedSecret, nonce);
const decryptedDebt = decryptValue(encryptedDebt, sharedSecret, nonce);
const decryptedHealth = decryptValue(encryptedHealth, sharedSecret, nonce);

console.log('\n✅ Decrypted (verifying round-trip):');
console.log('   Collateral USD:', decryptedCollateral);
console.log('   Debt USD:', decryptedDebt);
console.log('   Health Factor:', decryptedHealth);

// Verify values match
const match = 
  Math.abs(decryptedCollateral - position.collateralValueUSD) < 0.001 &&
  Math.abs(decryptedDebt - position.debtAmountUSD) < 0.001 &&
  Math.abs(decryptedHealth - position.healthFactor) < 0.001;

console.log('\n' + (match ? '✅ ENCRYPTION TEST PASSED!' : '❌ ENCRYPTION TEST FAILED'));
console.log('\n🔐 Ready for Arcium MXE integration (mock mode active)');
