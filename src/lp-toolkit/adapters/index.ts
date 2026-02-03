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
export { saberAdapter, SaberAdapter } from './saber';
export { cremaAdapter, CremaAdapter } from './crema';

// Adapter registry
import { meteoraAdapter } from './meteora';
import { meteoraDAMMAdapter } from './meteora-damm';
import { orcaAdapter } from './orca';
import { raydiumAdapter } from './raydium';
import { lifinityAdapter } from './lifinity';
import { saberAdapter } from './saber';
import { cremaAdapter } from './crema';
import { DEXAdapter, DEXVenue } from './types';

// Primary adapters (one per venue)
export const adapters: Record<DEXVenue, DEXAdapter | null> = {
  meteora: meteoraAdapter,           // DLMM (concentrated)
  'meteora-damm': meteoraDAMMAdapter, // DAMM v2 (full range)
  orca: orcaAdapter,                 // Whirlpool (concentrated)
  raydium: raydiumAdapter,           // CLMM (concentrated)
  lifinity: lifinityAdapter,         // Oracle-based, reduced IL
  saber: saberAdapter,               // Stable swaps
  crema: cremaAdapter,               // CLMM (concentrated)
  phoenix: null,                     // CLOB - skipped per Joe
};

// All adapters (LP only, no CLOB)
export const allAdapters: DEXAdapter[] = [
  meteoraAdapter,      // Meteora DLMM
  meteoraDAMMAdapter,  // Meteora DAMM v2
  orcaAdapter,         // Orca Whirlpool
  raydiumAdapter,      // Raydium CLMM
  lifinityAdapter,     // Lifinity (oracle-based)
  saberAdapter,        // Saber (stable swaps)
  cremaAdapter,        // Crema (concentrated)
];

export function getAdapter(venue: DEXVenue): DEXAdapter | null {
  return adapters[venue] || null;
}

export function getAllAdapters(): DEXAdapter[] {
  return allAdapters;
}

export default adapters;
