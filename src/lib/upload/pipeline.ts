// src/lib/upload/pipeline.ts
'use client';

import {
  AI_IMAGE_MAX_EDGE,
  DOC_IMAGE_EDGES,
  MAX_UPLOAD_BYTES,
  PREVIEW_MAX_EDGE,
} from '@/config/app';
import { AssetRepository, PhotoRepository } from '@/lib/db';
import { decodeImageFile, deriveVariants, ImageError } from '@/lib/image';
import { readExifFromBlob } from '@/lib/image/exif';
import { randomId } from '@/lib/utils';
import type { Photo, UploadStage } from '@/types/domain';

export type UploadProgressHandler = (stage: UploadStage, progress: number) => void;

const STAGE_PROGRESS: Record<UploadStage, number> = {
  decoding: 0.15,
  deriving: 0.5,
  persisting: 0.85,
  done: 1,
  failed: 0,
};

export async function uploadOnePhoto(
  file: File,
  projectId: string,
  onProgress?: UploadProgressHandler,
): Promise<Photo> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ImageError('IMAGE_TOO_LARGE', '图片体积超过上限');
  }

  const photoId = randomId();
  const report = (stage: UploadStage): void => onProgress?.(stage, STAGE_PROGRESS[stage]);

  try {
    report('decoding');
    const { bitmap, width, height } = await decodeImageFile(file);

    report('deriving');
    let variants;
    try {
      variants = await deriveVariants(bitmap, {
        preview: PREVIEW_MAX_EDGE,
        ai: AI_IMAGE_MAX_EDGE,
        doc: DOC_IMAGE_EDGES.high,
      });
    } finally {
      bitmap.close();
    }

    const order = await PhotoRepository.nextOrder(projectId);
    const photo: Photo = {
      id: photoId,
      projectId,
      order,
      fileName: file.name,
      mimeType: file.type || 'image/jpeg',
      fileSize: file.size,
      width,
      height,
      status: 'idle',
      selected: true,
      isEdited: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 拍摄时间：优先 EXIF，其次文件修改时间，最后上传时间
    // 0.4.2：同时保留完整 EXIF（相机/镜头/光圈/快门/ISO），用于展示与导出
    const exif = await readExifFromBlob(file).catch(() => null);
    const takenAt = exif?.takenAt ?? (file.lastModified || Date.now());

    report('persisting');
    await PhotoRepository.create({
      ...photo,
      takenAt,
      exif: exif ?? undefined,
    });

    await AssetRepository.put(photoId, 'original', file, {
      mime: file.type || 'image/jpeg',
      width,
      height,
    });

    const variants2 = ['preview', 'ai', 'doc'] as const;
    for (const variant of variants2) {
      const derived = variants[variant];
      await AssetRepository.put(photoId, variant, derived.blob, {
        mime: 'image/jpeg',
        width: derived.width,
        height: derived.height,
      });
    }

    report('done');
    return photo;
  } catch (error) {
    report('failed');
    await PhotoRepository.delete(photoId).catch(() => undefined);
    throw error;
  }
}
