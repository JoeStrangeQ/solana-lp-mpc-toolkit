/**
 * LP Toolkit - DEX Adapters
 * Unified interface for liquidity provision across Solana DEXs
 */

// Core types
export * from './types';

// Individual adapters
export { meteoraAdapter, MeteoraAdapter } from './meteora';
export { meteoraDAMMAdapter, MeteoraDAMMAdapter } from './meteora-damm';
export { orcaAdapter, OrcaAdapter } from './orca';
export { raydiumAdapter, RaydiumAdapter } from './raydium';
export { lifinityAdapter, LifinityAdapter } from './lifinity';

// Adapter registry
import { meteoraAdapter } from './meteora';
import { meteoraDAMMAdapter } from './meteora-damm';
import { orcaAdapter } from './orca';
import { raydiumAdapter } from './raydium';
import { lifinityAdapter } from './lifinity';
import { DEXAdapter, DEXVenue } from './types';

// Primary adapters (one per venue)
export const adapters: Record<DEXVenue, DEXAdapter | null> = {
  meteora: meteoraAdapter,    // DLMM (concentrated)
  orca: orcaAdapter,
  raydium: raydiumAdapter,
  phoenix: null,              // TODO: Implement
  lifinity: lifinityAdapter,  // Oracle-based, reduced IL
};

// All adapters including variants
export const allAdapters: DEXAdapter[] = [
  meteoraAdapter,      // Meteora DLMM
  meteoraDAMMAdapter,  // Meteora DAMM v2
  orcaAdapter,         // Orca Whirlpool
  raydiumAdapter,      // Raydium CLMM
  lifinityAdapter,     // Lifinity (oracle-based)
];

export function getAdapter(venue: DEXVenue): DEXAdapter | null {
  return adapters[venue] || null;
}

export function getAllAdapters(): DEXAdapter[] {
  return allAdapters;
}

export default adapters;
