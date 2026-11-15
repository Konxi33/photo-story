// src/lib/db/schema.ts
// 数据库结构定义：store 名称、索引名、类型映射、迁移步骤。

import type { DBSchema, IDBPDatabase } from 'idb';

import { DB_STORES } from '@/config/app';
import type { AssetRecord, Photo, Project } from '@/types/domain';

export interface KvRecord {
  key: string;
  value: unknown;
}

export const IDX = {
  projectsByUpdatedAt: 'updatedAt',
  photosByProject: 'projectId',
  photosByOrder: 'order',
  photosByProjectOrder: 'projectId-order',
  assetsByPhoto: 'photoId',
} as const;

export interface PhotoStoryDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
    indexes: { [IDX.projectsByUpdatedAt]: number };
  };
  photos: {
    key: string;
    value: Photo;
    indexes: {
      [IDX.photosByProject]: string;
      [IDX.photosByOrder]: number;
      [IDX.photosByProjectOrder]: [string, number];
    };
  };
  assets: {
    key: string;
    value: AssetRecord;
    indexes: { [IDX.assetsByPhoto]: string };
  };
  kv: {
    key: string;
    value: KvRecord;
  };
}

type Migration = (db: IDBPDatabase<PhotoStoryDB>) => void;

export const MIGRATIONS: Migration[] = [
  (db) => {
    const projects = db.createObjectStore(DB_STORES.projects, { keyPath: 'id' });
    projects.createIndex(IDX.projectsByUpdatedAt, 'updatedAt');

    const photos = db.createObjectStore(DB_STORES.photos, { keyPath: 'id' });
    photos.createIndex(IDX.photosByProject, 'projectId');
    photos.createIndex(IDX.photosByOrder, 'order');
    photos.createIndex(IDX.photosByProjectOrder, ['projectId', 'order']);

    const assets = db.createObjectStore(DB_STORES.assets, { keyPath: 'key' });
    assets.createIndex(IDX.assetsByPhoto, 'photoId');

    db.createObjectStore(DB_STORES.kv, { keyPath: 'key' });
  },
];
