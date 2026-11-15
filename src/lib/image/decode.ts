// src/lib/image/decode.ts
'use client';

import { MAX_IMAGE_PIXELS } from '@/config/app';
import type { PhotoErrorCode } from '@/types/domain';

export class ImageError extends Error {
  readonly code: PhotoErrorCode;

  constructor(code: PhotoErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ImageError';
    this.code = code;
  }
}

export interface DecodedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export async function decodeImageFile(file: File): Promise<DecodedImage> {
  if (file.type && !file.type.startsWith('image/')) {
    throw new ImageError('IMAGE_UNSUPPORTED', '这不是图片文件');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    throw new ImageError(
      'IMAGE_UNSUPPORTED',
      '当前浏览器无法解码这张图片，建议先转成 JPEG 后重试',
      error,
    );
  }

  if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) {
    bitmap.close();
    throw new ImageError('IMAGE_TOO_LARGE', '图片像素总量过大，请先缩小尺寸再上传');
  }

  return { bitmap, width: bitmap.width, height: bitmap.height };
}
