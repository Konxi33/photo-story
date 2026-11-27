// src/lib/review/export.ts
// 0.8.1：把评审室的结论导出成能存档/发给别人的表格。
// 三位评委的分歧点在这份表里最清楚——同列的三个分数差多少，一眼能看出来。
// 纯本地渲染，不发任何请求。

import { JUDGE_PERSONAS, type JudgeId } from '@/config/scorePrompt';
import { averageScore, spreadOf, type PhotoReview, type ReviewBoard } from '@/lib/review/store';

export interface ReviewExportPhoto {
  id: string;
  fileName: string;
  title?: string;
  number?: number;
}

export interface ReviewExportRow {
  number: number;
  title: string;
  fileName: string;
  average: number | null;
  spread: number | null;
  scores: Record<JudgeId, number | null>;
  advice: Record<JudgeId, string[]>;
}

const JUDGE_ORDER: JudgeId[] = ['editor', 'curator', 'tech'];

export const judgeName = (id: JudgeId): string =>
  JUDGE_PERSONAS.find((persona) => persona.id === id)?.name ?? id;

const escapeCell = (value: string): string =>
  /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** 把评审记录按「照片编号」对齐成行；没有评语的照片也保留，别悄悄吞掉 */
export function buildReviewRows(
  board: ReviewBoard | null,
  photos: ReviewExportPhoto[],
): ReviewExportRow[] {
  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const reviews: PhotoReview[] = board?.reviews ?? [];
  const rows = reviews
    .map((review, index) => {
      const photo = byId.get(review.photoId);
      const scores = {} as Record<JudgeId, number | null>;
      const advice = {} as Record<JudgeId, string[]>;
      for (const judge of JUDGE_ORDER) {
        const verdict = review.verdicts.find((item) => item.judge === judge);
        scores[judge] = verdict?.score ?? null;
        advice[judge] = verdict?.advice ?? (verdict?.error ? [verdict.error] : []);
      }
      return {
        number: photo?.number ?? index + 1,
        title: photo?.title?.trim() || photo?.fileName || review.photoId.slice(0, 8),
        fileName: photo?.fileName ?? '',
        average: averageScore(review),
        spread: spreadOf(review),
        scores,
        advice,
      };
    })
    .sort((a, b) => a.number - b.number);

  return rows;
}

const fixed = (value: number | null): string => (value == null ? '' : value.toFixed(1));

/** CSV：带表头、分歧度一列，Excel 里按分歧度排序就能找到「三个人吵起来」的那几张 */
export function buildReviewCsv(rows: ReviewExportRow[]): string {
  const head = [
    '编号',
    '标题',
    '文件名',
    '平均分',
    '分歧度',
    ...JUDGE_ORDER.map((judge) => judgeName(judge)),
    ...JUDGE_ORDER.map((judge) => `${judgeName(judge)}评语`),
  ];
  const body = rows.map((row) => [
    String(row.number),
    row.title,
    row.fileName,
    fixed(row.average),
    fixed(row.spread),
    ...JUDGE_ORDER.map((judge) => fixed(row.scores[judge])),
    ...JUDGE_ORDER.map((judge) => row.advice[judge].join(' / ')),
  ]);
  return [head, ...body].map((line) => line.map(escapeCell).join(',')).join('\r\n');
}

/** Markdown：人工阅读版，分歧大的排前面，评语按评委分行 */
export function buildReviewMarkdown(rows: ReviewExportRow[], projectName: string): string {
  const sorted = [...rows].sort((a, b) => (b.spread ?? -1) - (a.spread ?? -1));
  const lines: string[] = [`# ${projectName} · 评审记录`, ''];
  const avg = rows.map((row) => row.average).filter((value): value is number => value != null);
  if (avg.length > 0) {
    const mean = avg.reduce((sum, value) => sum + value, 0) / avg.length;
    lines.push(`共 ${rows.length} 张，平均 ${mean.toFixed(1)} 分。`, '');
  }
  lines.push('按分歧度从大到小排列——分差大的通常正是值得再看一眼的那几张。', '');
  for (const row of sorted) {
    lines.push(`## ${row.number}. ${row.title}`);
    const scoreLine = JUDGE_ORDER.map(
      (judge) => `${judgeName(judge)} ${fixed(row.scores[judge]) || '—'}`,
    ).join(' · ');
    const extra = [
      row.average == null ? null : `平均 ${fixed(row.average)}`,
      row.spread == null ? null : `分歧 ${fixed(row.spread)}`,
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(`- ${scoreLine}${extra ? `（${extra}）` : ''}`);
    for (const judge of JUDGE_ORDER) {
      for (const item of row.advice[judge]) {
        lines.push(`  - ${judgeName(judge)}：${item.trim()}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

export const reviewFileStem = (projectName: string): string => {
  const safe = projectName.replace(/[\\/:*?"<>|]/g, '').trim() || '照片故事';
  return `${safe}-评审记录-${new Date().toISOString().slice(0, 10)}`;
};
