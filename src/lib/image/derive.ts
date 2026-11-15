// src/lib/image/derive.ts
'use client';

import { JPEG_QUALITY } from '@/config/app';

import { ImageError } from './decode';

export type VariantName = 'preview' | 'ai' | 'doc';

export interface DerivedVariant {
  blob: Blob;
  width: number;
  height: number;
}

export type DerivedVariants = Record<VariantName, DerivedVariant>;

export interface VariantEdges {
  preview: number;
  ai: number;
  doc: number;
}

async function encodeAt(bitmap: ImageBitmap, maxEdge: number): Promise<DerivedVariant> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageError('UNKNOWN', '浏览器不支持 Canvas 2D');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
  });

  canvas.width = 0;
  canvas.height = 0;

  if (!blob) throw new ImageError('UNKNOWN', '图片编码失败');
  return { blob, width, height };
}

export async function deriveVariants(
  bitmap: ImageBitmap,
  edges: VariantEdges,
): Promise<DerivedVariants> {
  const preview = await encodeAt(bitmap, edges.preview);
  const ai = await encodeAt(bitmap, edges.ai);
  const doc = await encodeAt(bitmap, edges.doc);
  return { preview, ai, doc };
}
