// src/lib/backup.ts
'use client';

// 项目备份：把项目、照片元数据与全部图片档位打包成单个 JSON 文件下载；
// 导入时生成全新 id，避免与现有项目冲突。

import { AssetRepository, PhotoRepository, ProjectRepository } from '@/lib/db';
import { formatDateTime, randomId } from '@/lib/utils';
import { DOMAIN_SCHEMA_VERSION } from '@/types/domain';
import type { AssetVariant, Photo, Project, ProjectBackup } from '@/types/domain';

const VARIANTS: AssetVariant[] = ['original', 'preview', 'ai', 'doc'];

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mimeMatch = head.match(/data:(.*?);base64/);
  const mime = (mimeMatch && mimeMatch[1]) || 'application/octet-stream';

  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function blobSize(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}

/** 打包当前项目为 JSON 字符串；项目不存在返回 null */
export async function exportProjectBackup(projectId: string): Promise<string | null> {
  const project = await ProjectRepository.get(projectId);
  if (!project) return null;

  const photos = await PhotoRepository.listByProject(projectId);

  const entries: ProjectBackup['photos'] = [];
  for (const photo of photos) {
    const assets: ProjectBackup['photos'][number]['assets'] = {};
    for (const variant of VARIANTS) {
      const record = await AssetRepository.get(photo.id, variant);
      if (record) {
        assets[variant] = { mime: record.mime, base64: await blobToDataUrl(record.blob) };
      }
    }
    entries.push({ photo, assets });
  }

  const backup: ProjectBackup = {
    kind: 'photo-story-backup',
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    exportedAt: Date.now(),
    project,
    photos: entries,
  };

  return JSON.stringify(backup);
}

export function downloadBackup(json: string, projectName: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '照片故事备份_' + projectName + '_' + formatDateTime(Date.now()) + '.json';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 从备份 JSON 恢复为新项目，返回新项目 id 与照片数 */
export async function importProjectBackup(
  json: string,
): Promise<{ projectId: string; photoCount: number }> {
  let parsed: ProjectBackup;
  try {
    parsed = JSON.parse(json) as ProjectBackup;
  } catch {
    throw new Error('文件不是有效的 JSON');
  }

  if (!parsed || parsed.kind !== 'photo-story-backup') {
    throw new Error('不是照片故事的备份文件');
  }

  const newProjectId = randomId();
  const idMap = new Map<string, string>();
  for (const entry of parsed.photos) {
    idMap.set(entry.photo.id, randomId());
  }

  const project: Project = {
    ...parsed.project,
    id: newProjectId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    coverPhotoId: parsed.project.coverPhotoId
      ? (idMap.get(parsed.project.coverPhotoId) ?? undefined)
      : undefined,
  };
  await ProjectRepository.create(project);

  for (const entry of parsed.photos) {
    const newId = idMap.get(entry.photo.id);
    if (!newId) continue;

    const photo: Photo = {
      ...entry.photo,
      id: newId,
      projectId: newProjectId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await PhotoRepository.create(photo);

    for (const [variant, asset] of Object.entries(entry.assets)) {
      if (!asset) continue;
      const blob = dataUrlToBlob(asset.base64);
      const size = await blobSize(blob);
      await AssetRepository.put(newId, variant as AssetVariant, blob, {
        mime: asset.mime,
        width: size.width,
        height: size.height,
      });
    }
  }

  return { projectId: newProjectId, photoCount: parsed.photos.length };
}
