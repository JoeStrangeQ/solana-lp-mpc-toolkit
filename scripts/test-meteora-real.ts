import DLMM from '@meteora-ag/dlmm'
import { Connection, PublicKey } from '@solana/web3.js'
import BN from 'bn.js'

async function test() {
  console.log('Testing Meteora SDK with BN fix...')
  const connection = new Connection('https://api.mainnet-beta.solana.com')
  const poolAddress = new PublicKey('75y6pma4D9ry3qZyWbV6X9QFobNed8sLZh4N77vHQgZf')
  
  try {
    console.log('Creating DLMM instance...')
    const dlmm = await DLMM.create(connection, poolAddress)
    console.log('✅ DLMM created successfully!')
    console.log('Pool:', dlmm.pubkey.toString())
    console.log('Token X:', dlmm.tokenX.publicKey.toString())
    console.log('Token Y:', dlmm.tokenY.publicKey.toString())
    
    // Try getting active bin
    const activeBin = await dlmm.getActiveBin()
    console.log('Active Bin:', activeBin.binId)
    console.log('✅ Full SDK working!')
  } catch (e: any) {
    console.log('❌ SDK Error:', e.message)
    console.log('Stack:', e.stack?.split('\n').slice(0,5).join('\n'))
  }
}
test()
