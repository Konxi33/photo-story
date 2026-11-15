// src/lib/image/exif.ts
// 极简 EXIF 读取（不引第三方库，避免体积与打包风险）。
// 0.4.2：从「只读拍摄时间」扩展为完整拍摄参数（相机/镜头/光圈/快门/ISO/焦距）。

const TAG_EXIF_IFD = 0x8769;
const TAG_DATE_TIME_ORIGINAL = 0x9003;
const TAG_DATE_TIME = 0x0132;
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_ORIENTATION = 0x0112;
const TAG_F_NUMBER = 0x829d;
const TAG_EXPOSURE_TIME = 0x829a;
const TAG_ISO = 0x8827;
const TAG_FOCAL_LENGTH = 0x920a;
const TAG_LENS_MODEL = 0xa434;
const TAG_FOCAL_35 = 0xa405;

/** 一条可展示的拍摄参数 */
export interface ExifInfo {
  /** 拍摄时间戳（DateTimeOriginal 优先） */
  takenAt?: number;
  /** 机身厂商，如 XIAOMI */
  make?: string;
  /** 机身型号，如 14 Ultra */
  model?: string;
  /** 镜头，如 "23.0 mm f/1.63" */
  lens?: string;
  /** 光圈值，如 1.63 */
  aperture?: number;
  /** 快门速度（秒），如 0.008 */
  shutter?: number;
  /** 感光度 */
  iso?: number;
  /** 等效焦距 mm */
  focal35?: number;
  /** 原始焦距 mm */
  focal?: number;
  /** 画面方向 1-8 */
  orientation?: number;
}

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  /** 值区起始位置（绝对偏移） */
  valuePos: number;
}

const TYPE_SIZE: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
  7: 1, // UNDEFINED
  9: 4, // SLONG
  10: 8, // SRATIONAL
};

class TiffReader {
  constructor(
    private readonly view: DataView,
    private readonly tiffStart: number,
    private readonly little: boolean,
  ) {}

  u16(offset: number): number {
    return this.little ? this.view.getUint16(offset, true) : this.view.getUint16(offset, false);
  }

  u32(offset: number): number {
    return this.little ? this.view.getUint32(offset, true) : this.view.getUint32(offset, false);
  }

  /** 读取 IFD，返回 tag → 条目 */
  readIfd(start: number): Map<number, IfdEntry> {
    const out = new Map<number, IfdEntry>();
    const count = this.u16(start);
    if (count <= 0 || count > 512) return out;

    for (let i = 0; i < count; i += 1) {
      const entry = start + 2 + i * 12;
      if (entry + 12 > this.view.byteLength) break;

      const tag = this.u16(entry);
      const type = this.u16(entry + 2);
      const valueCount = this.u32(entry + 4);
      const size = (TYPE_SIZE[type] ?? 1) * valueCount;
      // 值小于 4 字节时内联在 entry+8，否则 entry+8 存的是偏移
      const valuePos = size <= 4 ? entry + 8 : this.tiffStart + this.u32(entry + 8);
      out.set(tag, { tag, type, count: valueCount, valuePos });
    }

    return out;
  }

  ascii(entry: IfdEntry, fallbackOffset = 0): string {
    const pos = entry.valuePos + fallbackOffset;
    let text = '';
    for (let i = 0; i < entry.count; i += 1) {
      const code = this.view.getUint8(pos + i);
      if (code === 0) break;
      text += String.fromCharCode(code);
    }
    return text.trim();
  }

  short(entry: IfdEntry): number {
    return this.u16(entry.valuePos);
  }

  rational(entry: IfdEntry): number | undefined {
    const denominator = this.u32(entry.valuePos + 4);
    if (!denominator) return undefined;
    const numerator = this.u32(entry.valuePos);
    return numerator / denominator;
  }
}

/** "2026:10:04 18:32:11" → 时间戳；解析失败返回 null */
function parseExifDate(text: string): number | null {
  const m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(text);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const value = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s),
  ).getTime();
  return Number.isFinite(value) ? value : null;
}

function parseTiff(view: DataView, tiffStart: number, little: boolean): ExifInfo | null {
  const reader = new TiffReader(view, tiffStart, little);
  const ifd0 = reader.readIfd(tiffStart + reader.u32(tiffStart + 4));
  if (ifd0.size === 0) return null;

  const info: ExifInfo = {};

  const make = ifd0.get(TAG_MAKE);
  if (make) info.make = reader.ascii(make);

  const model = ifd0.get(TAG_MODEL);
  if (model) {
    // 小米等会把厂商名重复写在型号里，去掉避免「XIAOMI XIAOMI 14 Ultra」
    let text = reader.ascii(model);
    if (info.make && text.toUpperCase().startsWith(info.make.toUpperCase())) {
      text = text.slice(info.make.length).trim();
    }
    info.model = text || undefined;
  }

  const orientation = ifd0.get(TAG_ORIENTATION);
  if (orientation) info.orientation = reader.short(orientation);

  const dateTime = ifd0.get(TAG_DATE_TIME);
  if (dateTime) {
    const parsed = parseExifDate(reader.ascii(dateTime));
    if (parsed) info.takenAt = parsed;
  }

  const exifPointer = ifd0.get(TAG_EXIF_IFD);
  if (exifPointer) {
    const exifIfd = reader.readIfd(tiffStart + reader.u32(exifPointer.valuePos));

    const original = exifIfd.get(TAG_DATE_TIME_ORIGINAL);
    if (original) {
      const parsed = parseExifDate(reader.ascii(original));
      // DateTimeOriginal 才是真正的拍摄时刻，优先于 IFD0 的 DateTime
      if (parsed) info.takenAt = parsed;
    }

    const lens = exifIfd.get(TAG_LENS_MODEL);
    if (lens) info.lens = reader.ascii(lens) || undefined;

    const aperture = exifIfd.get(TAG_F_NUMBER);
    if (aperture) info.aperture = reader.rational(aperture);

    const shutter = exifIfd.get(TAG_EXPOSURE_TIME);
    if (shutter) info.shutter = reader.rational(shutter);

    const iso = exifIfd.get(TAG_ISO);
    if (iso) info.iso = reader.short(iso);

    const focal = exifIfd.get(TAG_FOCAL_LENGTH);
    if (focal) info.focal = reader.rational(focal);

    const focal35 = exifIfd.get(TAG_FOCAL_35);
    if (focal35) info.focal35 = reader.short(focal35);
  }

  return info;
}

/** 从 JPEG 字节中读完整拍摄参数；不是 JPEG 或读不到返回 null */
export function readExif(buffer: ArrayBuffer): ExifInfo | null {
  try {
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return null;

    let offset = 2;
    while (offset + 4 <= view.byteLength) {
      if (view.getUint8(offset) !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = view.getUint8(offset + 1);
      const size = view.getUint16(offset + 2, false);

      if (marker === 0xe1) {
        const start = offset + 4;
        if (start + 6 > view.byteLength) return null;
        const signature =
          view.getUint32(start, false) === 0x45786966 && view.getUint16(start + 4, false) === 0;
        if (signature) {
          const tiffStart = start + 6;
          const endian = view.getUint16(tiffStart, false);
          if (endian !== 0x4949 && endian !== 0x4d4d) return null;
          return parseTiff(view, tiffStart, endian === 0x4949);
        }
      }

      if (marker === 0xda) break; // 进入图像数据
      offset += 2 + size;
    }

    return null;
  } catch {
    return null;
  }
}

/** 只读拍摄时间（兼容旧调用） */
export function readExifTakenAt(buffer: ArrayBuffer): number | null {
  return readExif(buffer)?.takenAt ?? null;
}

/** 从 Blob 读完整 EXIF（只读前 128KB，足够覆盖 APP1） */
export async function readExifFromBlob(blob: Blob): Promise<ExifInfo | null> {
  try {
    const head = await blob.slice(0, 128 * 1024).arrayBuffer();
    return readExif(head);
  } catch {
    return null;
  }
}

/** 从 Blob 读 EXIF 拍摄时间 */
export async function readTakenAtFromBlob(blob: Blob): Promise<number | null> {
  return (await readExifFromBlob(blob))?.takenAt ?? null;
}

/* ------------------------------ 展示格式化 ------------------------------ */

/** 0.0016 → "1/640"；2 → "2s" */
export function formatShutter(seconds?: number): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  if (seconds >= 1) return `${Number(seconds.toFixed(1))}s`;
  return `1/${Math.round(1 / seconds)}`;
}

export function formatAperture(value?: number): string | null {
  if (!value || !Number.isFinite(value)) return null;
  return `f/${Number(value.toFixed(value < 10 ? 1 : 0))}`;
}

/** 把 EXIF 拼成一行参数，用于卡片角标 / 编辑器 / 导出 */
export function formatExifLine(info?: ExifInfo | null): string {
  if (!info) return '';
  const parts: string[] = [];
  const shutter = formatShutter(info.shutter);
  const aperture = formatAperture(info.aperture);
  if (shutter) parts.push(shutter);
  if (aperture) parts.push(aperture);
  if (info.iso && info.iso <= 409600) parts.push(`ISO ${info.iso}`);
  const focal = info.focal35 ?? info.focal;
  // 0.5.3：部分机型的 EXIF 焦段是垃圾值（见过 12800mm），超出常识就不显示
  if (focal && focal >= 4 && focal <= 1200) parts.push(`${Math.round(focal)}mm`);
  return parts.join(' · ');
}

/** 机身描述，如 "XIAOMI 14 Ultra" */
export function formatCamera(info?: ExifInfo | null): string {
  if (!info) return '';
  return [info.make, info.model].filter(Boolean).join(' ').trim();
}
