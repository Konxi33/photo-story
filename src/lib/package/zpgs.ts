// src/lib/package/zpgs.ts
// 项目打包格式 .zpgs：一个 zip 容器，可在另一台电脑的照片故事里直接打开。
//
// 结构：
//   manifest.json                 { kind, formatVersion, schemaVersion, appVersion, exportedAt, project, photos[] }
//   assets/<photoId>/<variant>.jpg  original / preview / ai / doc
//
// 用 fflate 做 zip；图片本身已是 JPEG，压缩级别用 0（只打包不再压），速度快且不损失画质。

import { strToU8, unzipSync, zipSync } from 'fflate';

import { APP_VERSION } from '@/config/app';
import { AssetRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import { formatDateTime, randomId } from '@/lib/utils';
import { DOMAIN_SCHEMA_VERSION } from '@/types/domain';
import type { AssetVariant, Photo, Project } from '@/types/domain';

export const ZPGS_KIND = 'photo-story-package' as const;
export const ZPGS_FORMAT_VERSION = 1 as const;
export const ZPGS_EXTENSION = '.zpgs' as const;

const VARIANTS: AssetVariant[] = ['original', 'preview', 'ai', 'doc'];

interface VariantEntry {
  mime: string;
  /** zip 内路径 */
  path: string;
}

interface PackageManifest {
  kind: typeof ZPGS_KIND;
  formatVersion: number;
  schemaVersion: number;
  appVersion: string;
  exportedAt: number;
  project: Project;
  photos: Photo[];
  assets: Record<string, Partial<Record<AssetVariant, VariantEntry>>>;
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40) || '项目';
}

/** 导出项目为 .zpgs Blob；项目不存在返回 null */
export async function exportProjectToZpgs(
  projectId: string,
): Promise<{ blob: Blob; fileName: string } | null> {
  const project = await ProjectRepository.get(projectId);
  if (!project) return null;

  const photos = await PhotoRepository.listByProject(projectId);

  const files: Record<string, Uint8Array> = {};
  const assets: PackageManifest['assets'] = {};

  for (const photo of photos) {
    for (const variant of VARIANTS) {
      const record = await AssetRepository.get(photo.id, variant);
      if (!record) continue;

      const buffer = new Uint8Array(await record.blob.arrayBuffer());
      const ext = record.mime === 'image/png' ? 'png' : 'jpg';
      const assetPath = `assets/${photo.id}/${variant}.${ext}`;
      files[assetPath] = buffer;

      assets[photo.id] = {
        ...(assets[photo.id] ?? {}),
        [variant]: { mime: record.mime, path: assetPath },
      };
    }
  }

  const manifest: PackageManifest = {
    kind: ZPGS_KIND,
    formatVersion: ZPGS_FORMAT_VERSION,
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: Date.now(),
    project,
    photos,
    assets,
  };

  files['manifest.json'] = strToU8(JSON.stringify(manifest));

  const zipped = zipSync(files, { level: 0 });
  const blob = new Blob([zipped], { type: 'application/zip' });
  const fileName = `照片故事_${safeName(project.name)}_${formatDateTime(Date.now())}${ZPGS_EXTENSION}`;

  return { blob, fileName };
}

/** 触发下载 */
export function downloadZpgs(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function readManifest(file: File): Promise<PackageManifest> {
  const buffer = new Uint8Array(await file.arrayBuffer());

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buffer);
  } catch {
    throw new Error('不是有效的 .zpgs 文件（解压失败）');
  }

  const raw = entries['manifest.json'];
  if (!raw) throw new Error('压缩包里缺少 manifest.json，可能不是照片故事的项目包');

  let parsed: PackageManifest;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw)) as PackageManifest;
  } catch {
    throw new Error('manifest.json 解析失败');
  }

  if (parsed.kind !== ZPGS_KIND) throw new Error('这不是照片故事的 .zpgs 项目包');
  if (parsed.formatVersion > ZPGS_FORMAT_VERSION) {
    throw new Error('项目包版本较新（v' + parsed.formatVersion + '），请升级软件后再打开');
  }
  if (!parsed.project || !Array.isArray(parsed.photos)) {
    throw new Error('项目包结构不完整');
  }

  return parsed;
}

/**
 * 从 .zpgs 恢复项目。默认新建项目（不覆盖现有的），
 * 照片与资源全部重新分配 id，避免与已有数据冲突。
 */
export async function importProjectFromZpgs(
  file: File,
): Promise<{ projectId: string; photoCount: number; projectName: string }> {
  const manifest = await readManifest(file);
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()));

  const now = Date.now();
  const projectId = randomId();

  const project: Project = {
    ...manifest.project,
    id: projectId,
    name: manifest.project.name.trim() || '未命名项目',
    createdAt: now,
    updatedAt: now,
    coverPhotoId: undefined,
    schemaVersion: DOMAIN_SCHEMA_VERSION,
  };

  await ProjectRepository.create(project);

  let photoCount = 0;
  for (const [index, source] of manifest.photos.entries()) {
    const photoId = randomId();
    const assetMap = manifest.assets?.[source.id] ?? {};

    for (const variant of VARIANTS) {
      const entry = assetMap[variant];
      if (!entry) continue;
      const bytes = entries[entry.path];
      if (!bytes) continue;

      const blob = new Blob([bytes], { type: entry.mime || 'image/jpeg' });
      await AssetRepository.put(photoId, variant, blob, {
        mime: entry.mime || 'image/jpeg',
        width: source.width,
        height: source.height,
      });
    }

    const photo: Photo = {
      ...source,
      id: photoId,
      projectId,
      order: index * 1000,
    };

    await PhotoRepository.create(photo);
    photoCount += 1;

    if (source.id === manifest.project.coverPhotoId) {
      project.coverPhotoId = photoId;
    }
  }

  if (project.coverPhotoId) {
    await ProjectRepository.update(projectId, { coverPhotoId: project.coverPhotoId });
  }

  return { projectId, photoCount, projectName: project.name };
}
