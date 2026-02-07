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

// CLI entry point - modular server
// To use the legacy monolith, change this to: import './simple-server';
import './server';
