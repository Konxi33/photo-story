'use client';

// src/components/studio/block-tile.tsx
// 0.7.2：一块「积木」= 一张迷你版式缩略图 + 一个图标 + 两三个字。
//
// 这就是用户要的「积木描述」：不用读「照片 12×11」这种文字，
// 直接看见它在 12×24 的纸上占多大一块、在哪一角。
// 拖它的时候，跟着光标走的就是这张缩略图本身（dataTransfer.setDragImage）。

import { useState, type DragEvent } from 'react';
import { Plus } from 'lucide-react';

import { BLOCK_MAP, type PhotoBlockId } from '@/lib/export/blocks';
import type { LayoutItem } from '@/lib/export/layout';
import { cn } from '@/lib/utils';

import { BLOCK_ICON, BLOCK_SHORT } from './block-skin';
import { MiniLayout } from './mini-layout';

/** 从积木面板拖到纸面时用的 dataTransfer 类型（dragover 阶段读不到数据，只用作 drop 兜底） */
export const BLOCK_DRAG_MIME = 'application/x-ps-block';

interface BlockTileProps {
  id: PhotoBlockId;
  /** 已经在纸上的那一块（传了就显示它真实的占位，否则显示默认尺寸的虚线虚影） */
  item?: LayoutItem;
  /** 还没摆到纸上的默认占位（虚线虚影用） */
  preview: LayoutItem;
  selected?: boolean;
  onPick: (id: PhotoBlockId) => void;
  onDragStart: (id: PhotoBlockId) => void;
  onDragEnd: () => void;
}

export function BlockTile({
  id,
  item,
  preview,
  selected = false,
  onPick,
  onDragStart,
  onDragEnd,
}: BlockTileProps) {
  const [dragging, setDragging] = useState(false);
  const Icon = BLOCK_ICON[id];
  const meta = BLOCK_MAP[id];
  const placed = Boolean(item);

  const handleDragStart = (event: DragEvent<HTMLButtonElement>) => {
    onDragStart(id);
    setDragging(true);
    event.dataTransfer.effectAllowed = 'copyMove';
    event.dataTransfer.setData(BLOCK_DRAG_MIME, id);
    event.dataTransfer.setData('text/plain', meta.label);

    // 跟着光标走的就是这张缩略图本身 —— 直接把面板里那个节点交给浏览器当拖影
    const thumb = event.currentTarget.querySelector<HTMLElement>('[data-drag-thumb]');
    if (thumb) {
      event.dataTransfer.setDragImage(
        thumb,
        Math.round(thumb.offsetWidth / 2),
        Math.round(thumb.offsetHeight / 2),
      );
    }
  };

  return (
    <button
      type="button"
      draggable
      aria-label={`${meta.label}：${meta.hint}`}
      aria-pressed={placed}
      onDragStart={handleDragStart}
      onDragEnd={() => {
        setDragging(false);
        onDragEnd();
      }}
      onClick={() => onPick(id)}
      className={cn(
        'ps-tile group relative flex cursor-grab flex-col items-center gap-1 rounded-xl border px-1 pb-1 pt-1.5',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper',
        placed
          ? 'border-line/70 bg-surface-2/50'
          : 'border-line/45 bg-transparent hover:bg-surface-2/40',
        selected && 'border-copper/80 bg-copper/10',
        dragging && 'opacity-40',
      )}
    >
      <span data-drag-thumb className="pointer-events-none block w-10">
        <MiniLayout items={[item ?? preview]} ghost={!placed} />
      </span>

      <span className="flex max-w-full items-center gap-1 leading-none">
        <Icon
          className={cn('size-3 shrink-0', placed ? 'text-copper' : 'text-ink-faint')}
          aria-hidden
        />
        <span className="truncate text-[10.5px] text-ink">{BLOCK_SHORT[id]}</span>
      </span>

      {placed ? (
        <span className="absolute right-1 top-1 size-1.5 rounded-full bg-copper" />
      ) : (
        <span className="absolute right-1 top-1 grid size-3.5 place-items-center rounded-full bg-copper text-paper">
          <Plus className="size-2.5" aria-hidden />
        </span>
      )}

      <span className="ps-tile-tip" aria-hidden>
        {BLOCK_SHORT[id]}
        <span className="ml-1 tabular-nums opacity-55">
          {(item ?? preview).colSpan}×{(item ?? preview).rowSpan}
        </span>
      </span>
    </button>
  );
}
