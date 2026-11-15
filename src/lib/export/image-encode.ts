// src/lib/export/image-encode.ts
'use client';

import { JPEG_QUALITY } from '@/config/app';
import { CM_TO_PX96 } from '@/config/wordLayout';

export interface EncodedImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface DisplaySize {
  widthPx: number;
  heightPx: number;
}

const cache = new Map<string, EncodedImage>();

export function clearImageCache(): void {
  cache.clear();
}

export function fitIntoFrame(
  image: { width: number; height: number },
  frame: { widthCm: number; heightCm: number },
): DisplaySize {
  const frameW = CM_TO_PX96(frame.widthCm);
  const frameH = CM_TO_PX96(frame.heightCm);
  const scale = Math.min(frameW / image.width, frameH / image.height);
  return {
    widthPx: Math.max(1, Math.round(image.width * scale)),
    heightPx: Math.max(1, Math.round(image.height * scale)),
  };
}

export async function encodeImageForDocx(
  blob: Blob,
  targetEdge: number,
  cacheKey?: string,
  /** 目标宽高比（宽/高）。给了就按中心裁切填满，用来做整齐的总览缩略图网格 */
  aspect?: number,
): Promise<EncodedImage> {
  const key = cacheKey ? cacheKey + ':' + targetEdge + (aspect ? '@' + aspect : '') : null;
  if (key) {
    const hit = cache.get(key);
    if (hit) return hit;
  }

  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });

  // 需要统一比例时，从原图中心裁一块宽高比正确的区域，再缩放到目标边长
  let sx = 0;
  let sy = 0;
  let sw = bitmap.width;
  let sh = bitmap.height;

  if (aspect && aspect > 0) {
    const current = bitmap.width / bitmap.height;
    if (current > aspect) {
      sw = Math.round(bitmap.height * aspect);
      sx = Math.round((bitmap.width - sw) / 2);
    } else {
      sh = Math.round(bitmap.width / aspect);
      sy = Math.round((bitmap.height - sh) / 2);
    }
  }

  const scale = Math.min(1, targetEdge / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('浏览器不支持 Canvas 2D，无法导出图片');
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  bitmap.close();

  const encodedBlob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
  });

  canvas.width = 0;
  canvas.height = 0;

  if (!encodedBlob) throw new Error('图片编码失败');

  const result: EncodedImage = {
    data: new Uint8Array(await encodedBlob.arrayBuffer()),
    width,
    height,
  };

  if (key) cache.set(key, result);
  return result;
}
