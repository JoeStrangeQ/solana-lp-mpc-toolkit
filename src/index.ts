/**
 * LP Agent Toolkit
 * 
 * AI-native liquidity provision across Solana DEXs
 * with MPC custody and Arcium privacy
 */

export * from './gateway';
export * from './mpc';
export * from './privacy';
export * from './agent';
export * from './config';

// CLI entry point
import { startServer } from './agent/server';

if (require.main === module) {
  startServer();
}
// Rebuilt: 2026-02-04T22:06:38Z
