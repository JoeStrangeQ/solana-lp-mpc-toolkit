/**
 * LP Toolkit - DEX Adapters
 * Unified interface for liquidity provision across Solana DEXs
 */

// Core types
export * from './types';

// Individual adapters
export { meteoraAdapter, MeteoraAdapter } from './meteora';
export { orcaAdapter, OrcaAdapter } from './orca';
export { raydiumAdapter, RaydiumAdapter } from './raydium';

// Adapter registry
import { meteoraAdapter } from './meteora';
import { orcaAdapter } from './orca';
import { raydiumAdapter } from './raydium';
import { DEXAdapter, DEXVenue } from './types';

export const adapters: Record<DEXVenue, DEXAdapter> = {
  meteora: meteoraAdapter,
  orca: orcaAdapter,
  raydium: raydiumAdapter,
  phoenix: null as any, // TODO: Implement Phoenix adapter
};

export function getAdapter(venue: DEXVenue): DEXAdapter | null {
  return adapters[venue] || null;
}

export function getAllAdapters(): DEXAdapter[] {
  return Object.values(adapters).filter((a): a is DEXAdapter => a !== null);
}

export default adapters;
