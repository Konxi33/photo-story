'use client';

// 版式三选的「图示」：把每一种版式在纸上的样子画出来（24×34 缩略纸面），
// 一眼就能看出差别，不用读「极简画册 / 文艺随笔 / 技术档案」这几行字。
// 0.7.1：用户反复说「纯文字描述不直观」，这里是第一处改成图形的地方。

import { cn } from '@/lib/utils';

export type PaperStyleId = 'album' | 'essay' | 'archive';

interface StylePreviewProps {
  id: PaperStyleId;
  label: string;
  active?: boolean;
  onPick: () => void;
}

/** 纸面上的元素：照片（实心块）、正文（细线）、图注（短细线）、参数（两列细线） */
export function StylePreview({ id, label, active = false, onPick }: StylePreviewProps): React.ReactElement {
  const ink = active ? 'var(--color-ink)' : 'var(--color-ink-mid)';
  const faint = active ? 'var(--color-ink-mid)' : 'var(--color-ink-faint)';

  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      aria-label={`版式：${label}`}
      className={cn(
        'ps-tile group flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2 transition-colors duration-200',
        active
          ? 'border-copper/70 bg-copper/[0.07]'
          : 'border-line/50 bg-transparent hover:border-line hover:bg-surface-2/40',
      )}
    >
      <svg viewBox="0 0 24 34" className="h-[52px] w-[37px]" aria-hidden>
        <rect x="0.5" y="0.5" width="23" height="33" rx="1.6" fill="var(--color-paper)" stroke={faint} strokeWidth="0.5" />

        {id === 'album' && (
          <>
            {/* 大图居中 + 图注 + 三行正文 */}
            <rect x="3" y="4" width="18" height="12" fill={ink} opacity="0.82" />
            <rect x="3" y="17.2" width="7" height="0.9" fill={faint} />
            <rect x="3" y="20" width="18" height="0.8" fill={faint} opacity="0.8" />
            <rect x="3" y="22" width="18" height="0.8" fill={faint} opacity="0.8" />
            <rect x="3" y="24" width="12" height="0.8" fill={faint} opacity="0.8" />
            <rect x="18" y="29.5" width="3" height="0.8" fill={faint} />
          </>
        )}

        {id === 'essay' && (
          <>
            {/* 图片靠上靠左、留白衬底；正文宽栏 */}
            <rect x="3" y="4" width="18" height="11.5" fill="none" stroke={ink} strokeWidth="0.5" opacity="0.6" />
            <rect x="4.6" y="5.6" width="14.8" height="8.3" fill={ink} opacity="0.74" />
            <rect x="3" y="17.4" width="6" height="0.9" fill={faint} />
            <rect x="3" y="20.2" width="18" height="0.8" fill={faint} opacity="0.75" />
            <rect x="3" y="22.2" width="18" height="0.8" fill={faint} opacity="0.75" />
            <rect x="3" y="24.2" width="18" height="0.8" fill={faint} opacity="0.75" />
            <rect x="3" y="26.2" width="10" height="0.8" fill={faint} opacity="0.75" />
            <rect x="18" y="29.5" width="3" height="0.8" fill={faint} />
          </>
        )}

        {id === 'archive' && (
          <>
            {/* 细边框图 + 右侧参数两列 */}
            <rect x="3" y="4" width="18" height="10" fill="none" stroke={ink} strokeWidth="0.6" />
            <rect x="4.2" y="5.2" width="15.6" height="7.6" fill={ink} opacity="0.66" />
            <rect x="3" y="15.4" width="5" height="0.8" fill={faint} />
            <rect x="3" y="18" width="8" height="0.7" fill={faint} opacity="0.8" />
            <rect x="12.5" y="18" width="8" height="0.7" fill={faint} opacity="0.8" />
            <rect x="3" y="19.8" width="8" height="0.7" fill={faint} opacity="0.8" />
            <rect x="12.5" y="19.8" width="8" height="0.7" fill={faint} opacity="0.8" />
            <rect x="3" y="21.6" width="8" height="0.7" fill={faint} opacity="0.8" />
            <rect x="12.5" y="21.6" width="8" height="0.7" fill={faint} opacity="0.8" />
            <rect x="3" y="24.4" width="18" height="0.7" fill={faint} opacity="0.6" />
            <rect x="3" y="26.2" width="14" height="0.7" fill={faint} opacity="0.6" />
            <rect x="18" y="29.5" width="3" height="0.8" fill={faint} />
          </>
        )}
      </svg>
      <span className={cn('text-[11.5px] leading-none', active ? 'font-medium text-ink' : 'text-ink-mid')}>
        {label}
      </span>
    </button>
  );
}
