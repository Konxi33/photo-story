// src/lib/export/exporter.ts
'use client';

import { Packer } from 'docx';

import {
  COVER_IMAGE_EDGE,
  DOC_IMAGE_EDGES,
  EXPORT_FILENAME_PREFIX,
  HARD_SIZE_LIMIT_MB,
  MB,
  OVERVIEW_THUMB_EDGE,
} from '@/config/app';
import { readBook } from '@/lib/book/store';
import { AssetRepository } from '@/lib/db';
import { formatBytes, formatDateTime } from '@/lib/utils';
import type {
  ExportProgress,
  ExportResult,
  ExportSettings,
  ImageQuality,
  Photo,
  Project,
} from '@/types/domain';

import { buildDocument } from './document';
import { applyFrame } from './frame';
import { clearImageCache, encodeImageForDocx, type EncodedImage } from './image-encode';
import { saveDocument } from './output';

export interface ExportToDocxParams {
  project: Project;
  photos: Photo[];
  settings: ExportSettings;
  onProgress?: (progress: ExportProgress) => void;
  /** 0.5.4：固定导出目录（给了就直写，不再弹保存框） */
  outputDir?: string;
}

const QUALITY_LADDER: ImageQuality[] = ['ultra', 'high', 'standard'];

const edgeFor = (quality: ImageQuality): number => DOC_IMAGE_EDGES[quality];

async function encodeOne(
  photo: Photo,
  edge: number,
  settings: ExportSettings,
): Promise<EncodedImage | null> {
  const variant = edge > DOC_IMAGE_EDGES.high ? 'original' : 'doc';
  const asset = await AssetRepository.get(photo.id, variant);
  if (!asset) return null;
  try {
    const framed = await frameIfNeeded(asset.blob, photo, settings);
    const key = framed === asset.blob ? photo.id : photo.id + ':frame';
    return await encodeImageForDocx(framed, edge, key);
  } catch {
    return null;
  }
}

/** 导出前叠加相框与水印（关闭时原样返回，不产生额外开销） */
async function frameIfNeeded(
  blob: Blob,
  photo: Photo,
  settings: ExportSettings,
): Promise<Blob> {
  if (settings.frame === 'none' && !settings.watermark) return blob;
  try {
    return await applyFrame(blob, {
      style: settings.frame ?? 'none',
      watermark: settings.watermark,
      device: settings.watermarkText,
      author: settings.watermarkAuthor,
      params: photo.analysis?.params,
    });
  } catch {
    return blob;
  }
}

function qualityLabel(quality: ImageQuality): string {
  if (quality === 'ultra') return '超清';
  if (quality === 'high') return '高清';
  return '标准';
}

export async function exportToDocx(params: ExportToDocxParams): Promise<ExportResult> {
  const { project, photos, settings, onProgress, outputDir } = params;
  const startedAt = Date.now();
  const exportDate = new Date();

  const startIndex = Math.max(0, QUALITY_LADDER.indexOf(settings.imageQuality));
  let currentQuality: ImageQuality = QUALITY_LADDER[startIndex] ?? 'high';
  let downgraded = false;

  try {
    for (let step = startIndex; step < QUALITY_LADDER.length; step += 1) {
      currentQuality = QUALITY_LADDER[step] ?? 'standard';
      if (step > startIndex) {
        downgraded = true;
        clearImageCache();
      }

      const edge = edgeFor(currentQuality);

      const images = new Map<string, EncodedImage>();
      for (const [index, photo] of photos.entries()) {
        onProgress?.({
          stage: 'collecting',
          current: index,
          total: photos.length,
          message:
            '正在准备第 ' + (index + 1) + '/' + photos.length + ' 张照片…',
          detail: '画质：' + qualityLabel(currentQuality),
        });
        const encoded = await encodeOne(photo, edge, settings);
        if (encoded) images.set(photo.id, encoded);
      }

      const thumbs = new Map<string, EncodedImage>();
      if (settings.includeOverview) {
        for (const photo of photos) {
          const asset = await AssetRepository.get(photo.id, 'preview');
          if (!asset) continue;
          try {
            thumbs.set(
              photo.id,
              // 3:2 中心裁切 —— 总览页是整齐的方阵，宽高比统一的缩略图打印出来才好看
              await encodeImageForDocx(asset.blob, OVERVIEW_THUMB_EDGE, photo.id, 3 / 2),
            );
          } catch {
            // 单张缩略图失败就留空单元格
          }
        }
      }

      let coverImage: EncodedImage | undefined;
      if (settings.includeCover) {
        const coverId = settings.coverPhotoId ?? photos[0]?.id;
        if (coverId) {
          const asset = await AssetRepository.get(coverId, 'doc');
          if (asset) {
            try {
              coverImage = await encodeImageForDocx(asset.blob, COVER_IMAGE_EDGE, coverId);
            } catch {
              coverImage = undefined;
            }
          }
        }
      }

      onProgress?.({
        stage: 'rendering',
        current: photos.length,
        total: photos.length,
        message: '正在排版…',
      });

      // 0.5.2：编排台排过章节就按章节出书；没排过就走原来的平铺
      let chapters: { id: string; title: string; note: string; photoIds: string[] }[] = [];
      try {
        const book = await readBook(project.id);
        if (book && book.chapters.length > 0) {
          const validIds = new Set(photos.map((p) => p.id));
          chapters = book.chapters
            .map((chapter) => ({
              id: chapter.id,
              title: chapter.title,
              note: chapter.note,
              photoIds: chapter.photoIds.filter((id) => validIds.has(id)),
            }))
            .filter((chapter) => chapter.photoIds.length > 0 || chapter.title.trim().length > 0);
        }
      } catch {
        chapters = [];
      }

      const document = buildDocument({
        project,
        photos,
        images,
        thumbs,
        coverImage,
        settings,
        exportDate,
        chapters,
      });

      onProgress?.({
        stage: 'packing',
        current: photos.length,
        total: photos.length,
        message: '正在打包文档…',
      });

      const blob = await Packer.toBlob(document);
      const bytes = blob.size;

      if (bytes > HARD_SIZE_LIMIT_MB * MB) {
        if (step < QUALITY_LADDER.length - 1) continue;

        return {
          ok: false,
          photoCount: photos.length,
          durationMs: Date.now() - startedAt,
          error: {
            code: 'EXPORT_FAILED',
            message:
              '文档约 ' +
              formatBytes(bytes) +
              '，超过 ' +
              HARD_SIZE_LIMIT_MB +
              'MB 上限，建议分两批导出',
          },
        };
      }

      const fileName = EXPORT_FILENAME_PREFIX + '_' + formatDateTime(exportDate) + '.docx';
      const saved = await saveDocument(blob, fileName, outputDir);

      onProgress?.({
        stage: 'done',
        current: photos.length,
        total: photos.length,
        message: '已生成 ' + formatBytes(bytes),
      });

      return {
        ok: true,
        fileName,
        bytes,
        photoCount: photos.length,
        durationMs: Date.now() - startedAt,
        downgraded,
        filePath: saved.filePath,
      };
    }

    return {
      ok: false,
      photoCount: photos.length,
      durationMs: Date.now() - startedAt,
      error: { code: 'EXPORT_FAILED', message: '导出版本超出体积上限' },
    };
  } catch (error) {
    return {
      ok: false,
      photoCount: photos.length,
      durationMs: Date.now() - startedAt,
      error: {
        code: 'EXPORT_FAILED',
        message: error instanceof Error ? error.message : '导出失败',
      },
    };
  } finally {
    clearImageCache();
  }
}
