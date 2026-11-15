// src/lib/export/fonts.ts

import type { IRunOptions } from 'docx';

import { FONT_FALLBACK_HINT, type WordFontSpec } from '@/config/wordLayout';

type DocxFont = Exclude<IRunOptions['font'], string | undefined>;

export function buildRunFont(spec: WordFontSpec): DocxFont {
  return {
    ascii: spec.latin,
    hAnsi: spec.latin,
    eastAsia: spec.eastAsia,
    hint: FONT_FALLBACK_HINT,
  } as DocxFont;
}

export interface RunStyleOptions {
  color?: string;
  bold?: boolean;
  sizeHalfPt?: number;
}

export function buildRunStyle(spec: WordFontSpec, options: RunStyleOptions = {}): IRunOptions {
  return {
    font: buildRunFont(spec),
    size: options.sizeHalfPt ?? spec.sizeHalfPt,
    bold: options.bold ?? spec.bold,
    color: options.color,
  };
}
