/**
 * End-to-End Integration Test
 * Proves the complete agent flow works
 * 
 * Run: npm run api (in one terminal)
 * Then: npx tsx scripts/e2e-test.ts
 */

const API = process.env.API_URL || 'http://localhost:3456';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
  data?: any;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<any>): Promise<void> {
  const start = Date.now();
  try {
    const data = await fn();
    results.push({
      name,
      passed: true,
      duration: Date.now() - start,
      data,
    });
    console.log(`✅ ${name} (${Date.now() - start}ms)`);
  } catch (error: any) {
    results.push({
      name,
      passed: false,
      duration: Date.now() - start,
      error: error.message,
    });
    console.log(`❌ ${name}: ${error.message}`);
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🦀 LP Toolkit - End-to-End Integration Test');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\nAPI: ${API}\n`);

  // Test 1: Health Check
  await test('Health check', async () => {
    const res = await fetch(`${API}/v1/health`);
    const data = await res.json();
    if (data.status !== 'healthy') throw new Error('Not healthy');
    return data;
  });

  // Test 2: Pool Scanning
  await test('Scan SOL-USDC pools', async () => {
    const res = await fetch(`${API}/v1/pools/scan?tokenA=SOL&tokenB=USDC&limit=3`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    if (data.count === 0) throw new Error('No pools found');
    console.log(`   Found ${data.count} pools`);
    return data;
  });

  // Test 3: Intent Parsing - Add Liquidity
  await test('Parse "Add $500 to SOL-USDC"', async () => {
    const res = await fetch(`${API}/v1/intent/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Add $500 to the best SOL-USDC pool' }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    if (data.intent.action !== 'add_liquidity') throw new Error('Wrong action parsed');
    console.log(`   Intent: ${data.intent.action}, $${data.intent.totalValueUSD}`);
    return data;
  });

  // Test 4: Intent Parsing - Scan
  await test('Parse "Show me the best pools"', async () => {
    const res = await fetch(`${API}/v1/intent/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'What are the best yielding stablecoin pools?' }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    console.log(`   Intent: ${data.intent.action}`);
    return data;
  });

  // Test 5: Strategy Encryption
  const testWallet = '11111111111111111111111111111111';
  await test('Encrypt strategy with Arcium', async () => {
    const res = await fetch(`${API}/v1/encrypt/strategy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerPubkey: testWallet,
        strategy: {
          tokenA: 'SOL',
          tokenB: 'USDC',
          totalValueUSD: 500,
          strategy: 'concentrated',
        },
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    if (!data.encrypted.id) throw new Error('No encryption ID');
    console.log(`   Encrypted ID: ${data.encrypted.id}`);
    console.log(`   Arcium cluster: ${data.arciumCluster}`);
    return data;
  });

  // Test 6: Position Query
  await test('Query positions for wallet', async () => {
    const res = await fetch(`${API}/v1/positions/${testWallet}`);
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    console.log(`   Positions: ${data.count}`);
    return data;
  });

  // Test 7: Build Unsigned TX
  await test('Build unsigned add-liquidity TX', async () => {
    const res = await fetch(`${API}/v1/tx/add-liquidity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userPubkey: testWallet,
        venue: 'meteora',
        tokenA: 'SOL',
        tokenB: 'USDC',
        amountA: 1.0,
        amountB: 150,
      }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    if (!data.transaction.serialized) throw new Error('No serialized TX');
    console.log(`   TX size: ${data.transaction.serialized.length} chars`);
    console.log(`   Fee: ${data.transaction.estimatedFee} SOL`);
    return data;
  });

  // Test 8: Describe TX
  await test('Describe transaction', async () => {
    // First build a TX
    const buildRes = await fetch(`${API}/v1/tx/add-liquidity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userPubkey: testWallet,
        venue: 'meteora',
        tokenA: 'SOL',
        tokenB: 'USDC',
        amountA: 0.5,
        amountB: 75,
      }),
    });
    const buildData = await buildRes.json();
    
    // Then describe it
    const res = await fetch(`${API}/v1/tx/describe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serializedTx: buildData.transaction.serialized }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    console.log(`   Instructions: ${data.description.instructions}`);
    return data;
  });

  // Test 9: Full Agent Flow
  await test('Complete agent flow simulation', async () => {
    const userMessage = 'Add $1000 to the best SOL-USDC pool';
    
    // Step 1: Parse intent
    const intentRes = await fetch(`${API}/v1/intent/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: userMessage }),
    });
    const { intent } = await intentRes.json();
    
    // Step 2: Find best pool
    const poolsRes = await fetch(`${API}/v1/pools/scan?tokenA=${intent.tokenA}&tokenB=${intent.tokenB}&limit=1`);
    const { pools } = await poolsRes.json();
    
    // Step 3: Encrypt strategy
    const encRes = await fetch(`${API}/v1/encrypt/strategy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerPubkey: testWallet,
        strategy: intent,
      }),
    });
    const { encrypted } = await encRes.json();
    
    // Step 4: Build unsigned TX
    const txRes = await fetch(`${API}/v1/tx/add-liquidity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userPubkey: testWallet,
        poolAddress: pools[0]?.address,
        venue: pools[0]?.venue || 'meteora',
        tokenA: intent.tokenA,
        tokenB: intent.tokenB,
        amountA: intent.totalValueUSD / 2 / 150, // Rough SOL estimate
        amountB: intent.totalValueUSD / 2,
      }),
    });
    const { transaction } = await txRes.json();
    
    console.log(`   Flow complete!`);
    console.log(`   → Intent: ${intent.action}`);
    console.log(`   → Best pool: ${pools[0]?.name || 'auto'}`);
    console.log(`   → Encrypted: ${encrypted.id}`);
    console.log(`   → TX ready for signing`);
    
    return { intent, pool: pools[0], encrypted, transaction };
  });

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 Test Results');
  console.log('═══════════════════════════════════════════════════════════\n');

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  console.log(`Total time: ${totalTime}ms`);

  if (failed > 0) {
    console.log('\n❌ Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   - ${r.name}: ${r.error}`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  
  if (passed === results.length) {
    console.log('🎉 ALL TESTS PASSED! Ready for production.');
  } else {
    console.log(`⚠️  ${failed} test(s) failed. Check errors above.`);
  }
  
  console.log('═══════════════════════════════════════════════════════════');
  
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
