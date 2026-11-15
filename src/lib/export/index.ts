// src/lib/export/index.ts

export { buildRunFont, buildRunStyle, type RunStyleOptions } from './fonts';
export {
  clearImageCache,
  encodeImageForDocx,
  fitIntoFrame,
  type DisplaySize,
  type EncodedImage,
} from './image-encode';
export {
  bodyParagraph,
  cmToTwips,
  dividerParagraph,
  headingParagraph,
  mixedBodyParagraph,
  pageBreakParagraph,
  spacerParagraph,
  type BodyOptions,
  type HeadingOptions,
  type MixedRun,
} from './paragraphs';

export { buildCoverSection, type CoverParams } from './cover';
export { buildOverviewSection, type OverviewParams } from './overview';
export { buildPhotoSection, type PhotoSectionParams } from './body';
export { buildDocument, type BuildDocumentParams } from './document';
export { exportToDocx, type ExportToDocxParams } from './exporter';
export { exportToPptx, type ExportPptxParams } from './pptx';
export { exportToPdf, type ExportPdfParams, type PdfResult } from './pdf';
