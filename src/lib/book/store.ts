// src/lib/book/store.ts
// 0.5.2：成书编排的数据层。
// 「编排」= 把入选照片分进章节、排好顺序、给每章写一句题记。
// 存本地 kv（ps:book），结构：{ [projectId]: Book }。
// Word 导出会读它：章节顺序决定成书顺序，每章开头插一页章节页。

import { KvRepository } from '@/lib/db';
import type { Photo } from '@/types/domain';

export const BOOK_KEY = 'ps:book';

export interface BookChapter {
  id: string;
  title: string;
  /** 章节题记，一句话，可空 */
  note: string;
  photoIds: string[];
}

export interface Book {
  projectId: string;
  chapters: BookChapter[];
  updatedAt: number;
}

type BookMap = Record<string, Book>;

const newId = (): string =>
  `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export function createChapter(title = '', photoIds: string[] = []): BookChapter {
  return { id: newId(), title, note: '', photoIds };
}

export async function readAllBooks(): Promise<BookMap> {
  try {
    return (await KvRepository.get<BookMap>(BOOK_KEY)) ?? {};
  } catch {
    return {};
  }
}

export async function readBook(projectId: string): Promise<Book | null> {
  const all = await readAllBooks();
  return all[projectId] ?? null;
}

export async function writeBook(book: Book): Promise<void> {
  const all = await readAllBooks();
  all[book.projectId] = { ...book, updatedAt: Date.now() };
  await KvRepository.set(BOOK_KEY, all);
}

export async function removeBook(projectId: string): Promise<void> {
  const all = await readAllBooks();
  delete all[projectId];
  await KvRepository.set(BOOK_KEY, all);
}

/** 照片时间：优先拍摄时间，其次导入时间 */
export const photoTime = (photo: Photo): number => photo.takenAt ?? photo.createdAt;

const MONTH_DAY = (ts: number): string => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/**
 * 自动分章：按拍摄日期分组，一天一章；同一天超过 8 张再拆成「上午/下午/傍晚」之外的三段，
 * 避免一章塞进二十张照片、翻页节奏垮掉。
 */
export function autoChapters(photos: Photo[]): BookChapter[] {
  const sorted = [...photos].sort((a, b) => photoTime(a) - photoTime(b));
  const byDay = new Map<string, Photo[]>();

  for (const photo of sorted) {
    const d = new Date(photoTime(photo));
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    const list = byDay.get(key);
    if (list) list.push(photo);
    else byDay.set(key, [photo]);
  }

  const chapters: BookChapter[] = [];
  for (const [key, list] of byDay) {
    const first = list[0];
    if (!first) continue;
    const label = MONTH_DAY(photoTime(first));
    if (list.length <= 8) {
      chapters.push(createChapter(label, list.map((p) => p.id)));
      continue;
    }
    const parts = Math.ceil(list.length / 8);
    for (let i = 0; i < parts; i += 1) {
      const slice = list.slice(i * 8, i * 8 + 8);
      chapters.push(createChapter(`${label} · ${i + 1}`, slice.map((p) => p.id)));
    }
    void key;
  }

  return chapters;
}

/** 把章节里已经不存在的照片剔掉，并把重复出现的照片只保留第一次 */
export function cleanChapters(chapters: BookChapter[], validIds: Set<string>): BookChapter[] {
  const seen = new Set<string>();
  return chapters.map((chapter) => {
    const photoIds = chapter.photoIds.filter((id) => {
      if (!validIds.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    return { ...chapter, photoIds };
  });
}

/** 章节顺序下摊平出来的照片 id 序列 */
export function flattenChapters(chapters: BookChapter[]): string[] {
  return chapters.flatMap((c) => c.photoIds);
}

/** 成书体量：章节页 + 照片页 + 封面 + 目录 */
export function estimatePages(chapters: BookChapter[], photoCount: number): number {
  return 2 + chapters.length + photoCount;
}
