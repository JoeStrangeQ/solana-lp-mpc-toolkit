/**
 * Usage Stats - In-memory request and action tracking
 */
export const stats = {
  startedAt: new Date().toISOString(),
  requests: {
    total: 0,
    byEndpoint: {} as Record<string, number>,
    byHour: {} as Record<string, number>,
  },
  actions: {
    walletsCreated: 0,
    walletsLoaded: 0,
    transfers: 0,
    lpExecuted: 0,
    lpWithdrawn: 0,
    encryptions: 0,
  },
  errors: 0,
  lastRequest: null as string | null,
};
