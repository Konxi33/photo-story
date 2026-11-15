// src/components/workbench/PhotoGrid.tsx
'use client';

import { useState } from 'react';
import { ImageOff, Images } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import { cn } from '@/lib/utils';
import type { ScreenRect } from '@/lib/motion';
import type { Photo } from '@/types/domain';

import type { PhotoFilter } from './BatchToolbar';
import { PhotoCard } from './PhotoCard';
import { PhotoStoryPreview } from './PhotoStoryPreview';

export type PhotoView = 'grid' | 'wall';

interface PhotoGridProps {
  photos: Photo[];
  filter: PhotoFilter;
  previews: Record<string, string>;
  coverPhotoId?: string;
  view?: PhotoView;
  columns?: number;
  onToggleSelect: (id: string) => void;
  onEdit: (id: string) => void;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  onSetCover?: (id: string) => void;
  onScore?: (id: string) => Promise<boolean>;
  onReorder?: (orderedIds: string[]) => void;
}

const FILTER_PREDICATES: Record<PhotoFilter, (p: Photo) => boolean> = {
  all: () => true,
  success: (p) => p.status === 'success',
  pending: (p) => p.status === 'idle',
  failed: (p) => p.status === 'failed',
  selected: (p) => p.selected,
};

export function PhotoGrid({
  photos,
  filter,
  previews,
  coverPhotoId,
  view = 'grid',
  columns = 3,
  onToggleSelect,
  onEdit,
  onRetry,
  onDelete,
  onSetCover,
  onScore,
  onReorder,
}: PhotoGridProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  // 打开预览时缩略图的位置，用来做「从缩略图长出来」的放大动画
  const [origin, setOrigin] = useState<ScreenRect | null>(null);

  // 拖拽排序只在「网格 + 全部」下启用，避免过滤视图里把顺序拖乱
  const sortable = view === 'grid' && filter === 'all' && Boolean(onReorder);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  if (photos.length === 0) {
    return (
      <div className="ps-enter flex flex-col items-center justify-center rounded-[14px] border border-dashed border-line/80 bg-surface-2/40 px-6 py-20 text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-faint">
          <Images className="h-5 w-5" strokeWidth={1.4} />
        </span>
        <p className="text-[15px] font-medium text-ink">还没有照片</p>
        <p className="mt-1.5 text-[12.5px] text-ink-faint">用上面的窄条添加，或者直接把照片拖进来。</p>
      </div>
    );
  }

  const visible = photos.filter(FILTER_PREDICATES[filter]);

  if (visible.length === 0) {
    return (
      <div className="ps-enter flex flex-col items-center justify-center rounded-[14px] border border-dashed border-line/80 bg-surface-2/40 px-6 py-20 text-center">
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-2 text-ink-faint">
          <ImageOff className="h-5 w-5" strokeWidth={1.4} />
        </span>
        <p className="text-[15px] font-medium text-ink">这个筛选下没有照片</p>
        <p className="mt-1.5 text-[12.5px] text-ink-faint">换一个筛选条件试试。</p>
      </div>
    );
  }

  const openPreview = (photoId: string, rect?: ScreenRect): void => {
    const idx = visible.findIndex((p) => p.id === photoId);
    if (idx >= 0) {
      setOrigin(rect ?? null);
      setLightboxIndex(idx);
    }
  };

  const renderCard = (photo: Photo, index: number) => (
    <PhotoCard
      photo={photo}
      index={index + 1}
      previewUrl={previews[photo.id]}
      variant={view === 'wall' ? 'wall' : 'card'}
      isCover={coverPhotoId === photo.id}
      onToggleSelect={onToggleSelect}
      onEdit={onEdit}
      onRetry={onRetry}
      onDelete={onDelete}
      onSetCover={onSetCover}
      onPreview={(rect) => openPreview(photo.id, rect)}
    />
  );

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id || !onReorder) return;
    const oldIndex = visible.findIndex((p) => p.id === active.id);
    const newIndex = visible.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(visible, oldIndex, newIndex).map((p) => p.id));
  };

  const lightbox = lightboxIndex !== null && (
    <PhotoStoryPreview
      photos={visible}
      index={Math.min(lightboxIndex, visible.length - 1)}
      previews={previews}
      isCover={coverPhotoId === visible[lightboxIndex]?.id}
      origin={origin}
      onClose={() => setLightboxIndex(null)}
      onNavigate={setLightboxIndex}
      onEdit={onEdit}
      onSetCover={onSetCover}
      onScore={onScore}
    />
  );

  // 照片墙：瀑布流，图片保持原始比例
  if (view === 'wall') {
    return (
      <>
        <div
          className={cn(
            'gap-4 [column-fill:balance]',
            columns >= 4 ? 'columns-2 xl:columns-4 md:columns-3' : 'columns-2 md:columns-3',
          )}
        >
          {visible.map((photo, index) => (
            <div key={photo.id} className="mb-4">
              {renderCard(photo, index)}
            </div>
          ))}
        </div>
        {lightbox}
      </>
    );
  }

  const gridStyle = { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` };

  const cards = visible.map((photo, index) => {
    const card = renderCard(photo, index);
    if (!sortable) return <div key={photo.id}>{card}</div>;
    return (
      <SortableCard key={photo.id} id={photo.id}>
        {card}
      </SortableCard>
    );
  });

  return (
    <>
      {sortable ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visible.map((p) => p.id)} strategy={rectSortingStrategy}>
            <div className="grid gap-4" style={gridStyle}>
              {cards}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <div className="grid gap-4" style={gridStyle}>
          {cards}
        </div>
      )}
      {lightbox}
    </>
  );
}

/* ------------------------------ 可拖拽外壳 ------------------------------- */

function SortableCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('cursor-grab active:cursor-grabbing', isDragging && 'z-10 opacity-90')}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}
