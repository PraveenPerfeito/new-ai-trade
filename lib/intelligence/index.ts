// Types
export * from './types';

// Cache group config
export * from './cache-groups';

// Quota guard
export { QuotaGuard, getQuotaGuard } from './quota-guard';

// Cache readers (used by scanner + API routes)
export {
  readListings,
  readGlobal,
  readTrending,
  readCategories,
  readMetadata,
  getIntelligenceCoins,
  isStale,
} from './reader';

// Pre-scan warm-up
export { preloadIntelligence } from './preloader';
export type { PreloadResult } from './preloader';

// Background workers
export {
  startIntelligenceWorkers,
  stopIntelligenceWorkers,
  getWorkerStatuses,
} from './workers';
