// src/lib/review/store.ts
// 评审室结果的本地存档。
// 三位评委各打一次分，结果按项目存起来，下次打开还能看到上次的结论；
// 不写进 Photo.analysis，是为了不污染「正式评分」——评审室是另一套口径。

import type { JudgeId } from '@/config/scorePrompt';

export interface JudgeVerdict {
  judge: JudgeId;
  /** 该评委给的总分；失败时为 null */
  score: number | null;
  /** 该评委的 2–3 条评语 */
  advice: string[];
  /** 失败原因（有则 score 为 null） */
  error?: string;
}

export interface PhotoReview {
  photoId: string;
  verdicts: JudgeVerdict[];
  at: number;
}

export interface ReviewBoard {
  projectId: string;
  reviews: PhotoReview[];
  updatedAt: number;
}

const KEY = 'ps:review';

type BoardMap = Record<string, ReviewBoard>;

function readMap(): BoardMap {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as BoardMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: BoardMap): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // 存储满了也不该中断评审，静默丢弃
  }
}

export function readBoard(projectId: string): ReviewBoard | null {
  const board = readMap()[projectId];
  if (!board || !Array.isArray(board.reviews)) return null;
  return board;
}

export function writeBoard(board: ReviewBoard): void {
  const map = readMap();
  map[board.projectId] = board;
  writeMap(map);
}

export function clearBoard(projectId: string): void {
  const map = readMap();
  delete map[projectId];
  writeMap(map);
}

/** 三位评委的平均分（忽略失败的） */
export function averageScore(review: PhotoReview): number | null {
  const scores = review.verdicts
    .map((v) => v.score)
    .filter((s): s is number => typeof s === 'number');
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** 分歧度：最高分与最低分之差。0 表示三人完全一致 */
export function spreadOf(review: PhotoReview): number | null {
  const scores = review.verdicts
    .map((v) => v.score)
    .filter((s): s is number => typeof s === 'number');
  if (scores.length < 2) return null;
  return Math.max(...scores) - Math.min(...scores);
}