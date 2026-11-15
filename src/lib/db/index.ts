// src/lib/db/index.ts
// IndexedDB 层的统一出口。

export { getDB, closeDB, isDBAvailable, DbError } from './client';
export { ProjectRepository, PhotoRepository, AssetRepository, KvRepository } from './repository';
export { IDX, MIGRATIONS, type PhotoStoryDB, type KvRecord } from './schema';
