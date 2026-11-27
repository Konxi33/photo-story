// 0.8.1：印张（signature）补页。
//
// 印刷厂按「印张」装订，一张纸正反印 4 面（对开折页后正好 4 页），
// 所以整本书的页数最好是 4 的倍数；不是的话最后一叠会空出一半，
// 装订出来中间夹着空纸。真书都是把最后补 1～3 页留白。
//
// 预览（/flip）和 Word / PDF 导出都从这一个文件算页数，
// 否则会出现「预览说 12 页、打出来 13 页」这种对不上的事。

/** 一个章节的照片数达到这个数量才单独排章扉页（导出的 chapter.ts 用同一条规则） */
export const CHAPTER_OPENER_MIN = 4;

/** 印张的页数粒度：一张纸 4 页 */
export const SIGNATURE_MULTIPLE = 4;

export interface SignatureInput {
  /** 章节，`photoCount` 是这一章实际排进书里的照片数（没照片的章节算呼吸页） */
  chapters: { title: string; note: string; photoCount: number }[];
  /** 没有分章时的平铺张数（导出会退化成「一张一页」） */
  flatPhotoCount?: number;
  hasCover?: boolean;
  hasOverview?: boolean;
  hasAppendix?: boolean;
}

/**
 * 估算成书页数：封面 + 总览 + 每章（章扉页 + 图版页）+ 呼吸页 + 附录。
 * 和 `src/app/flip/page.tsx` 的页序列、导出的区块顺序一一对应。
 */
export function countSignaturePages(input: SignatureInput): number {
  let count = 0;
  if (input.hasCover !== false) count += 1;
  if (input.hasOverview !== false) count += 1;

  if (input.chapters.length === 0) {
    // 平铺导出：一张照片一页，没有章扉
    count += Math.max(0, input.flatPhotoCount ?? 0);
  }

  for (const chapter of input.chapters) {
    if (chapter.photoCount <= 0) {
      // 空章节只在「没标题、有题记」时是一页留白（呼吸页），否则什么都不印
      if (!chapter.title.trim() && chapter.note.trim()) count += 1;
      continue;
    }
    count += chapter.photoCount;
    if (chapter.photoCount >= CHAPTER_OPENER_MIN) count += 1;
  }

  if (input.hasAppendix !== false) count += 1;
  return count;
}

/** 还差几页才凑满印张 */
export function padToMultiple(count: number, multiple: number = SIGNATURE_MULTIPLE): number {
  if (count <= 0 || multiple <= 1) return 0;
  const rest = count % multiple;
  return rest === 0 ? 0 : multiple - rest;
}

/** 章节只需要这三个字段，导出参数的章节结构正好也是这个样子 */
export interface SignatureChapterSource {
  title: string;
  note: string;
  photoIds: string[];
}

/** 从章节结构直接算要补几页（导出侧用） */
export function padForBook(
  chapters: SignatureChapterSource[],
  options: {
    flatPhotoCount?: number;
    hasCover?: boolean;
    hasOverview?: boolean;
    hasAppendix?: boolean;
  } = {},
): number {
  const count = countSignaturePages({
    chapters: chapters.map((chapter) => ({
      title: chapter.title,
      note: chapter.note,
      photoCount: chapter.photoIds.length,
    })),
    ...options,
  });
  return padToMultiple(count);
}
