// src/lib/db/client.ts
// IndexedDB 单例连接与统一错误类型。

import { openDB, type IDBPDatabase } from 'idb';

import { DB_NAME, DB_VERSION } from '@/config/app';
import type { PhotoErrorCode } from '@/types/domain';

import { MIGRATIONS, type PhotoStoryDB } from './schema';

export class DbError extends Error {
  readonly code: PhotoErrorCode;

  constructor(code: PhotoErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'DbError';
    this.code = code;
  }
}

let dbPromise: Promise<IDBPDatabase<PhotoStoryDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<PhotoStoryDB>> {
  if (dbPromise) return dbPromise;

  if (typeof indexedDB === 'undefined') {
    throw new DbError(
      'DB_UNAVAILABLE',
      '当前浏览器不支持 IndexedDB，请更换浏览器或退出无痕模式',
    );
  }

  dbPromise = openDB<PhotoStoryDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      for (let v = oldVersion; v < MIGRATIONS.length; v += 1) {
        MIGRATIONS[v]?.(db);
      }
    },
    blocked() {
      console.warn('[db] 另一端仍占用旧版本数据库，请关闭其他标签页');
    },
    blocking() {
      console.warn('[db] 当前连接阻止了升级，即将自动关闭');
    },
    terminated() {
      console.warn('[db] 连接被浏览器终止，下次调用会重新打开');
      dbPromise = null;
    },
  }).catch((error: unknown) => {
    dbPromise = null;
    throw new DbError('DB_UNAVAILABLE', '打开本地数据库失败，可能是隐私模式或空间不足', error);
  });

  return dbPromise;
}

export async function closeDB(): Promise<void> {
  if (!dbPromise) return;
  const db = await dbPromise.catch(() => null);
  db?.close();
  dbPromise = null;
}

export async function isDBAvailable(): Promise<boolean> {
  try {
    const db = await getDB();
    return db.objectStoreNames.contains('projects');
  } catch {
    return false;
  }
}
