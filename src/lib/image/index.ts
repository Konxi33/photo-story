// src/lib/image/index.ts
'use client';

export { decodeImageFile, ImageError, type DecodedImage } from './decode';
export {
  deriveVariants,
  type DerivedVariant,
  type DerivedVariants,
  type VariantEdges,
  type VariantName,
} from './derive';
