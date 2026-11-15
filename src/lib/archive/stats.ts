// src/lib/archive/stats.ts
// 0.5.2：摄影档案的统计内核。纯函数，不碰 IndexedDB，方便单独验证。

import type { Photo } from '@/types/domain';

export interface Bucket {
  name: string;
  count: number;
}

export interface MonthPoint {
  key: string;
  label: string;
  count: number;
  scored: number;
  avg: number | null;
}

export interface ArchiveStats {
  total: number;
  scored: number;
  avgScore: number | null;
  bestScore: number | null;
  selected: number;
  shootingDays: number;
  firstShot: number | null;
  lastShot: number | null;
  months: MonthPoint[];
  hours: number[];
  busiestHour: number | null;
  tags: Bucket[];
  bodies: Bucket[];
  lenses: Bucket[];
  apertures: Bucket[];
  focals: Bucket[];
  exifCount: number;
  focalTop: Bucket | null;
}

export const photoTime = (photo: Photo): number =>
  photo.exif?.takenAt ?? photo.takenAt ?? photo.createdAt;

const APERTURE_BUCKETS: { name: string; max: number }[] = [
  { name: 'f/1.8 及更大', max: 1.8 },
  { name: 'f/2 – f/2.8', max: 2.8 },
  { name: 'f/3.5 – f/5.6', max: 5.6 },
  { name: 'f/8 – f/11', max: 11 },
  { name: 'f/14 及更小', max: Number.POSITIVE_INFINITY },
];

const FOCAL_BUCKETS: { name: string; max: number }[] = [
  { name: '≤ 24mm', max: 24 },
  { name: '25–35mm', max: 35 },
  { name: '36–50mm', max: 50 },
  { name: '51–85mm', max: 85 },
  { name: '86–135mm', max: 135 },
  { name: '> 135mm', max: Number.POSITIVE_INFINITY },
];

function bucketize(values: (number | undefined)[], buckets: { name: string; max: number }[]): Bucket[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value == null || !Number.isFinite(value) || value <= 0) continue;
    const hit = buckets.find((b) => value <= b.max) ?? buckets[buckets.length - 1];
    if (!hit) continue;
    counts.set(hit.name, (counts.get(hit.name) ?? 0) + 1);
  }
  return buckets
    .map((b) => ({ name: b.name, count: counts.get(b.name) ?? 0 }))
    .filter((b) => b.count > 0);
}

function tally(values: (string | undefined)[], limit = 6): Bucket[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

const monthKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export function buildArchiveStats(photos: Photo[], monthsBack = 12): ArchiveStats {
  const hours = new Array<number>(24).fill(0);
  const dayKeys = new Set<string>();
  const monthMap = new Map<string, { count: number; sum: number; scored: number }>();

  // 先把最近 N 个月的槽位铺好，缺失的月份也要显示成 0，趋势才连续
  const now = new Date();
  const monthOrder: string[] = [];
  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = monthKey(d);
    monthOrder.push(key);
    monthMap.set(key, { count: 0, sum: 0, scored: 0 });
  }

  let scoreSum = 0;
  let scoreCount = 0;
  let bestScore: number | null = null;
  let firstShot: number | null = null;
  let lastShot: number | null = null;
  let exifCount = 0;
  let selected = 0;

  for (const photo of photos) {
    const time = photoTime(photo);
    const date = new Date(time);

    if (Number.isFinite(time)) {
      if (firstShot === null || time < firstShot) firstShot = time;
      if (lastShot === null || time > lastShot) lastShot = time;
      dayKeys.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
      hours[date.getHours()] = (hours[date.getHours()] ?? 0) + 1;
    }

    const key = monthKey(date);
    const slot = monthMap.get(key);
    if (slot) slot.count += 1;

    const overall = photo.analysis?.score?.overall;
    if (typeof overall === 'number' && Number.isFinite(overall)) {
      scoreSum += overall;
      scoreCount += 1;
      if (slot) {
        slot.sum += overall;
        slot.scored += 1;
      }
      if (bestScore === null || overall > bestScore) bestScore = overall;
    }

    if (photo.selected) selected += 1;
    if (photo.exif && (photo.exif.aperture || photo.exif.focal35 || photo.exif.model)) exifCount += 1;
  }

  const months: MonthPoint[] = monthOrder.map((key) => {
    const slot = monthMap.get(key) ?? { count: 0, sum: 0, scored: 0 };
    const [, m] = key.split('-');
    return {
      key,
      label: `${Number(m)}月`,
      count: slot.count,
      scored: slot.scored,
      avg: slot.scored > 0 ? slot.sum / slot.scored : null,
    };
  });

  let busiestHour: number | null = null;
  for (let h = 0; h < 24; h += 1) {
    const count = hours[h] ?? 0;
    if (count === 0) continue;
    if (busiestHour === null || count > (hours[busiestHour] ?? 0)) busiestHour = h;
  }

  const focals = bucketize(
    photos.map((p) => p.exif?.focal35 ?? p.exif?.focal),
    FOCAL_BUCKETS,
  );

  return {
    total: photos.length,
    scored: scoreCount,
    avgScore: scoreCount > 0 ? scoreSum / scoreCount : null,
    bestScore,
    selected,
    shootingDays: dayKeys.size,
    firstShot,
    lastShot,
    months,
    hours,
    busiestHour,
    tags: tally(photos.flatMap((p) => p.analysis?.tags ?? []), 10),
    bodies: tally(
      photos.map((p) => [p.exif?.make, p.exif?.model].filter(Boolean).join(' ') || undefined),
      5,
    ),
    lenses: tally(photos.map((p) => p.exif?.lens), 5),
    apertures: bucketize(photos.map((p) => p.exif?.aperture), APERTURE_BUCKETS),
    focals,
    exifCount,
    focalTop: focals[0] ?? null,
  };
}

/** 把小时按「清晨/上午/午后/傍晚/夜里」归成四段，用于一句话总结 */
export function hourSegment(hour: number): string {
  if (hour >= 5 && hour < 11) return '清晨到上午';
  if (hour >= 11 && hour < 15) return '正午前后';
  if (hour >= 15 && hour < 19) return '傍晚';
  if (hour >= 19 && hour < 23) return '夜里';
  return '深夜';
}

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
