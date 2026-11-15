// src/lib/db/repository.ts
// 所有 IndexedDB 读写的唯一入口。写操作先落库，UI 由调用方在 await 之后更新。

import { ORDER_STEP } from '@/config/app';
import type { AssetRecord, AssetVariant, Photo, Project, ProjectSummary } from '@/types/domain';

import { DbError, getDB } from './client';
import { IDX, type KvRecord } from './schema';

const STORES = {
  projects: 'projects',
  photos: 'photos',
  assets: 'assets',
  kv: 'kv',
} as const;

function wrap(error: unknown, fallback = '数据库操作失败'): DbError {
  if (error instanceof DbError) return error;
  return new DbError('UNKNOWN', fallback, error);
}

const now = (): number => Date.now();

export const ProjectRepository = {
  async create(project: Project): Promise<Project> {
    try {
      const db = await getDB();
      const value: Project = { ...project, createdAt: project.createdAt || now(), updatedAt: now() };
      await db.put(STORES.projects, value);
      return value;
    } catch (error) {
      throw wrap(error, '创建项目失败');
    }
  },

  async get(id: string): Promise<Project | undefined> {
    try {
      const db = await getDB();
      return await db.get(STORES.projects, id);
    } catch (error) {
      throw wrap(error, '读取项目失败');
    }
  },

  async list(): Promise<ProjectSummary[]> {
    try {
      const db = await getDB();
      const projects = await db.getAllFromIndex(STORES.projects, IDX.projectsByUpdatedAt);
      const summaries: ProjectSummary[] = [];

      for (const project of projects.reverse()) {
        const photos = await db.getAllFromIndex(STORES.photos, IDX.photosByProject, project.id);
        summaries.push({
          id: project.id,
          name: project.name,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          coverPhotoId: project.coverPhotoId,
          photoCount: photos.length,
          successCount: photos.filter((p) => p.status === 'success').length,
          failedCount: photos.filter((p) => p.status === 'failed').length,
        });
      }

      return summaries;
    } catch (error) {
      throw wrap(error, '读取项目列表失败');
    }
  },

  async update(id: string, patch: Partial<Omit<Project, 'id'>>): Promise<Project> {
    try {
      const db = await getDB();
      const tx = db.transaction(STORES.projects, 'readwrite');
      const current = await tx.store.get(id);
      if (!current) throw new DbError('UNKNOWN', '项目不存在');
      const next: Project = { ...current, ...patch, id, updatedAt: now() };
      await tx.store.put(next);
      await tx.done;
      return next;
    } catch (error) {
      throw wrap(error, '更新项目失败');
    }
  },

  async rename(id: string, name: string): Promise<Project> {
    return ProjectRepository.update(id, { name: name.trim() });
  },

  async delete(id: string): Promise<void> {
    try {
      const db = await getDB();
      const tx = db.transaction([STORES.projects, STORES.photos, STORES.assets], 'readwrite');
      const photos = await tx.objectStore(STORES.photos).index(IDX.photosByProject).getAll(id);

      for (const photo of photos) {
        await tx.objectStore(STORES.photos).delete(photo.id);
        const assets = await tx
          .objectStore(STORES.assets)
          .index(IDX.assetsByPhoto)
          .getAllKeys(photo.id);
        for (const key of assets) {
          await tx.objectStore(STORES.assets).delete(key);
        }
      }

      await tx.objectStore(STORES.projects).delete(id);
      await tx.done;
    } catch (error) {
      throw wrap(error, '删除项目失败');
    }
  },
};

export const PhotoRepository = {
  async create(photo: Photo): Promise<Photo> {
    try {
      const db = await getDB();
      const value: Photo = { ...photo, createdAt: photo.createdAt || now(), updatedAt: now() };
      await db.put(STORES.photos, value);
      return value;
    } catch (error) {
      throw wrap(error, '保存照片失败');
    }
  },

  async get(id: string): Promise<Photo | undefined> {
    try {
      const db = await getDB();
      return await db.get(STORES.photos, id);
    } catch (error) {
      throw wrap(error, '读取照片失败');
    }
  },

  async listByProject(projectId: string, options?: { includeDeleted?: boolean }): Promise<Photo[]> {
    try {
      const db = await getDB();
      const range = IDBKeyRange.bound([projectId, -Infinity], [projectId, Infinity]);
      const rows = await db.getAllFromIndex(STORES.photos, IDX.photosByProjectOrder, range);
      return options?.includeDeleted ? rows : rows.filter((row) => !row.deletedAt);
    } catch (error) {
      throw wrap(error, '读取照片列表失败');
    }
  },

  /** 0.5.2：跨项目读取全部照片（摄影档案统计用） */
  async listAll(options?: { includeDeleted?: boolean }): Promise<Photo[]> {
    try {
      const db = await getDB();
      const rows = await db.getAll(STORES.photos);
      return options?.includeDeleted ? rows : rows.filter((row) => !row.deletedAt);
    } catch (error) {
      throw wrap(error, '读取全部照片失败');
    }
  },

  /** 0.5.6：回收站列表，按删除时间倒序 */
  async listDeleted(): Promise<Photo[]> {
    const rows = await PhotoRepository.listAll({ includeDeleted: true });
    return rows
      .filter((row) => Boolean(row.deletedAt))
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
  },

  /** 0.5.6：软删除（进回收站，可恢复） */
  async softDelete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const stamp = now();
    await PhotoRepository.updateMany(ids, { deletedAt: stamp });
  },

  /** 0.5.6：从回收站恢复 */
  async restore(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDB();
    const tx = db.transaction(STORES.photos, 'readwrite');
    for (const id of ids) {
      const current = await tx.store.get(id);
      if (!current) continue;
      const next: Photo = { ...current, deletedAt: undefined, updatedAt: now() };
      await tx.store.put(next);
    }
    await tx.done;
  },

  /** 0.5.6：彻底删除（连素材一起删，不可恢复） */
  async purge(ids: string[]): Promise<void> {
    for (const id of ids) {
      await AssetRepository.deleteByPhoto(id);
      await PhotoRepository.delete(id);
    }
  },

  async nextOrder(projectId: string): Promise<number> {
    const photos = await PhotoRepository.listByProject(projectId);
    const last = photos.at(-1);
    return (last?.order ?? 0) + ORDER_STEP;
  },

  async update(id: string, patch: Partial<Omit<Photo, 'id' | 'projectId'>>): Promise<Photo> {
    try {
      const db = await getDB();
      const tx = db.transaction(STORES.photos, 'readwrite');
      const current = await tx.store.get(id);
      if (!current) throw new DbError('UNKNOWN', '照片不存在');
      const next: Photo = { ...current, ...patch, id, updatedAt: now() };
      await tx.store.put(next);
      await tx.done;
      return next;
    } catch (error) {
      throw wrap(error, '更新照片失败');
    }
  },

  async updateMany(ids: string[], patch: Partial<Omit<Photo, 'id' | 'projectId'>>): Promise<void> {
    if (ids.length === 0) return;
    try {
      const db = await getDB();
      const tx = db.transaction(STORES.photos, 'readwrite');
      for (const id of ids) {
        const current = await tx.store.get(id);
        if (!current) continue;
        await tx.store.put({ ...current, ...patch, id, updatedAt: now() });
      }
      await tx.done;
    } catch (error) {
      throw wrap(error, '批量更新照片失败');
    }
  },

  async delete(id: string): Promise<void> {
    try {
      const db = await getDB();
      const tx = db.transaction([STORES.photos, STORES.assets], 'readwrite');
      await tx.objectStore(STORES.photos).delete(id);
      const keys = await tx.objectStore(STORES.assets).index(IDX.assetsByPhoto).getAllKeys(id);
      for (const key of keys) {
        await tx.objectStore(STORES.assets).delete(key);
      }
      await tx.done;
    } catch (error) {
      throw wrap(error, '删除照片失败');
    }
  },

  async deleteByProject(projectId: string): Promise<void> {
    try {
      const db = await getDB();
      const tx = db.transaction(STORES.photos, 'readwrite');
      const keys = await tx.store.index(IDX.photosByProject).getAllKeys(projectId);
      for (const key of keys) {
        await tx.store.delete(key);
      }
      await tx.done;
    } catch (error) {
      throw wrap(error, '按项目删除照片失败');
    }
  },

  async reorder(orderedIds: string[]): Promise<void> {
    if (orderedIds.length === 0) return;
    try {
      const db = await getDB();
      const tx = db.transaction(STORES.photos, 'readwrite');
      for (let i = 0; i < orderedIds.length; i += 1) {
        const id = orderedIds[i];
        if (!id) continue;
        const current = await tx.store.get(id);
        if (!current) continue;
        await tx.store.put({ ...current, order: (i + 1) * ORDER_STEP, updatedAt: now() });
      }
      await tx.done;
    } catch (error) {
      throw wrap(error, '重排照片失败');
    }
  },
};

const assetKey = (photoId: string, variant: AssetVariant): string => `${photoId}:${variant}`;

export const AssetRepository = {
  async put(
    photoId: string,
    variant: AssetVariant,
    blob: Blob,
    meta: { mime: string; width: number; height: number },
  ): Promise<AssetRecord> {
    try {
      const db = await getDB();
      const record: AssetRecord = {
        key: assetKey(photoId, variant),
        photoId,
        variant,
        blob,
        mime: meta.mime,
        width: meta.width,
        height: meta.height,
        bytes: blob.size,
        createdAt: now(),
      };
      await db.put(STORES.assets, record);
      return record;
    } catch (error) {
      throw wrap(error, '保存图片资源失败');
    }
  },

  async get(photoId: string, variant: AssetVariant): Promise<AssetRecord | undefined> {
    try {
      const db = await getDB();
      return await db.get(STORES.assets, assetKey(photoId, variant));
    } catch (error) {
      throw wrap(error, '读取图片资源失败');
    }
  },

  async getByPhoto(photoId: string): Promise<AssetRecord[]> {
    try {
      const db = await getDB();
      return await db.getAllFromIndex(STORES.assets, IDX.assetsByPhoto, photoId);
    } catch (error) {
      throw wrap(error, '读取照片资源失败');
    }
  },

  async deleteByPhoto(photoId: string): Promise<void> {
    try {
      const db = await getDB();
      const tx = db.transaction(STORES.assets, 'readwrite');
      const keys = await tx.store.index(IDX.assetsByPhoto).getAllKeys(photoId);
      for (const key of keys) {
        await tx.store.delete(key);
      }
      await tx.done;
    } catch (error) {
      throw wrap(error, '删除照片资源失败');
    }
  },

  async deleteByProject(projectId: string): Promise<void> {
    try {
      const db = await getDB();
      const tx = db.transaction([STORES.photos, STORES.assets], 'readwrite');
      const photoKeys = await tx.objectStore(STORES.photos).index(IDX.photosByProject).getAllKeys(
        projectId,
      );
      for (const photoId of photoKeys) {
        const keys = await tx
          .objectStore(STORES.assets)
          .index(IDX.assetsByPhoto)
          .getAllKeys(photoId);
        for (const key of keys) {
          await tx.objectStore(STORES.assets).delete(key);
        }
      }
      await tx.done;
    } catch (error) {
      throw wrap(error, '按项目删除图片资源失败');
    }
  },
};

export const KvRepository = {
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const db = await getDB();
      const record = (await db.get(STORES.kv, key)) as KvRecord | undefined;
      return record?.value as T | undefined;
    } catch (error) {
      throw wrap(error, '读取本地设置失败');
    }
  },

  async set(key: string, value: unknown): Promise<void> {
    try {
      const db = await getDB();
      await db.put(STORES.kv, { key, value } satisfies KvRecord);
    } catch (error) {
      throw wrap(error, '写入本地设置失败');
    }
  },

  async delete(key: string): Promise<void> {
    try {
      const db = await getDB();
      await db.delete(STORES.kv, key);
    } catch (error) {
      throw wrap(error, '删除本地设置失败');
    }
  },
};
