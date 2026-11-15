// src/components/workbench/BatchToolbar.tsx
// 0.5.1：工具栏重排——主操作（批量生成/停止）在最左，搜索居中，次级动作全收进「更多」，
// 右侧只剩「视图 + 列数 + 筛选」三个紧凑控件；整体改成玻璃浮条，滚动时贴在顶栏下方。

'use client';

import {
  BookOpen,
  BookOpenCheck,
  ClipboardCopy,
  Eraser,
  Gauge,
  Grid2x2,
  LayoutGrid,
  ListChecks,
  MoreHorizontal,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Tags,
  Trash2,
  Wallpaper,
  Wand2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type PhotoFilter = 'all' | 'success' | 'pending' | 'failed' | 'selected';
export type PhotoView = 'grid' | 'wall';

export const PHOTO_FILTER_LABELS: Record<PhotoFilter, string> = {
  all: '全部',
  success: '成功',
  pending: '待处理',
  failed: '失败',
  selected: '已选',
};

const FILTER_ORDER: PhotoFilter[] = ['all', 'success', 'pending', 'failed', 'selected'];
const COLUMN_OPTIONS = [2, 3, 4, 5];

interface BatchToolbarProps {
  pendingCount: number;
  filter: PhotoFilter;
  onFilterChange: (filter: PhotoFilter) => void;
  onBatchGenerate: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  running?: boolean;
  onStop?: () => void;
  view?: PhotoView;
  onViewChange?: (view: PhotoView) => void;
  columns?: number;
  onColumnsChange?: (columns: number) => void;
  /** 0.3.2：批量补评分 */
  unscoredCount?: number;
  scoring?: boolean;
  onBatchScore?: () => void;
  /** 0.3.5：一键重生成全部（换模型后用） */
  regenerating?: boolean;
  onRegenerateAll?: () => void;
  canRegenerate?: boolean;
  /** 0.4.0：批量删除 */
  selectedCount?: number;
  totalCount?: number;
  onDeleteSelected?: () => void;
  onDeleteAll?: () => void;
  /** 0.4.1：一键复制全部文案 */
  onCopyAllText?: () => void;
  /** 0.4.1：项目内搜索 */
  keyword?: string;
  onKeywordChange?: (value: string) => void;
  /** 0.5.0：按分数选择 */
  onSelectByScore?: (minScore: number) => void;
  /** 0.5.2：跳到编排台，把这一批照片排成章节 */
  onOpenBook?: () => void;
  onOpenFlip?: () => void;
  /** 0.5.6：批量改标签 / 氛围（作用于所选照片） */
  onBatchTags?: () => void;
  /** 0.5.0：智能精选（按分数 + 题材分散） */
  onSmartSelect?: (count: number) => void;
}

export function BatchToolbar({
  pendingCount,
  filter,
  onFilterChange,
  onBatchGenerate,
  onSelectAll,
  onClearSelection,
  running = false,
  onStop,
  view = 'grid',
  onViewChange,
  columns = 3,
  onColumnsChange,
  unscoredCount = 0,
  scoring = false,
  onBatchScore,
  regenerating = false,
  onRegenerateAll,
  canRegenerate = true,
  selectedCount = 0,
  totalCount = 0,
  onDeleteSelected,
  onDeleteAll,
  onCopyAllText,
  keyword = '',
  onKeywordChange,
  onSelectByScore,
  onOpenBook,
  onOpenFlip,
  onBatchTags,
  onSmartSelect,
}: BatchToolbarProps) {
  return (
    <div className="sticky top-[calc(3.5rem+1px)] z-20 -mx-1 mb-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-line/50 bg-paper/80 px-2 py-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] backdrop-blur-xl">
      {running ? (
        <Button
          size="sm"
          variant="outline"
          className="h-8 rounded-full border-destructive/30 px-3 text-destructive hover:bg-destructive/8 hover:text-destructive"
          onClick={onStop}
        >
          <Square className="mr-1.5 h-3 w-3" />
          停止生成
        </Button>
      ) : (
        <Button
          size="sm"
          className="h-8 rounded-full px-3.5"
          onClick={onBatchGenerate}
          disabled={pendingCount === 0}
          title={pendingCount === 0 ? '没有待处理的照片' : '快捷键：Ctrl + Enter'}
        >
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          批量生成
          <span className="ml-1.5 rounded-full bg-paper/20 px-1.5 text-[10.5px] tabular-nums">
            {pendingCount}
          </span>
        </Button>
      )}

      <span className="mx-0.5 h-4 w-px bg-line/70" />

      {/* 全选 / 反选 */}
      <button
        type="button"
        onClick={onSelectAll}
        title="全选可见照片"
        className="ps-pressable h-8 rounded-full px-2.5 text-[12px] text-ink-mid transition-colors hover:bg-ink/6 hover:text-ink"
      >
        全选
      </button>
      <button
        type="button"
        onClick={onClearSelection}
        title="清空选择"
        className="ps-pressable h-8 rounded-full px-2.5 text-[12px] text-ink-mid transition-colors hover:bg-ink/6 hover:text-ink"
      >
        反选
      </button>

      {/* 搜索：占据剩余空间，宽度足够长标题 */}
      <div className="relative flex h-8 min-w-[9rem] flex-1 items-center">
        <Search className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-ink-faint" />
        <Input
          value={keyword}
          onChange={(e) => onKeywordChange?.(e.target.value)}
          placeholder="搜标题 / 文件名 / 标签"
          className="h-8 rounded-full pl-8 text-[12.5px]"
        />
        {keyword && (
          <button
            type="button"
            onClick={() => onKeywordChange?.('')}
            aria-label="清空搜索"
            className="absolute right-2.5 text-ink-faint transition-colors hover:text-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* 次级动作收进「更多」 */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-full px-2.5 text-ink-mid"
            title="更多操作"
          >
            <MoreHorizontal className="h-4 w-4" />
            {selectedCount > 0 && (
              <span className="ml-1 rounded-full bg-ink px-1.5 text-[10px] tabular-nums text-paper">
                {selectedCount}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          {onOpenBook && (
            <>
              <DropdownMenuItem onSelect={() => onOpenBook()}>
                <BookOpen className="mr-2 h-3.5 w-3.5" />
                编排成书
              </DropdownMenuItem>
              {onOpenFlip && (
                <DropdownMenuItem onSelect={() => onOpenFlip()}>
                  <BookOpenCheck className="mr-2 h-3.5 w-3.5" />
                  翻页预览
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}
          {onRegenerateAll && (
            <DropdownMenuItem
              disabled={regenerating || running || !canRegenerate}
              onSelect={() => onRegenerateAll()}
            >
              <RefreshCw className={cn('mr-2 h-3.5 w-3.5', regenerating && 'animate-spin')} />
              {regenerating ? '重生成中…' : '一键重生成'}
            </DropdownMenuItem>
          )}
          {onCopyAllText && (
            <DropdownMenuItem onSelect={() => onCopyAllText()}>
              <ClipboardCopy className="mr-2 h-3.5 w-3.5" />
              复制全部文案
            </DropdownMenuItem>
          )}
          {onBatchScore && (
            <DropdownMenuItem disabled={scoring || unscoredCount === 0} onSelect={() => onBatchScore()}>
              <Gauge className="mr-2 h-3.5 w-3.5" />
              {scoring
                ? '评分中…'
                : unscoredCount > 0
                  ? `补评分 (${unscoredCount})`
                  : '补评分 · 无缺项'}
            </DropdownMenuItem>
          )}

          {onSelectByScore && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>按分数选择</DropdownMenuLabel>
              {[80, 70, 60].map((min) => (
                <DropdownMenuItem key={min} onSelect={() => onSelectByScore(min)}>
                  <ListChecks className="mr-2 h-3.5 w-3.5" />
                  选 ≥ {min} 分
                </DropdownMenuItem>
              ))}
            </>
          )}

          {onSmartSelect && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>智能精选 · 高分且题材分散</DropdownMenuLabel>
              {[6, 9, 12, 18].map((n) => (
                <DropdownMenuItem key={n} onSelect={() => onSmartSelect(n)}>
                  <Wand2 className="mr-2 h-3.5 w-3.5" />
                  精选 {n} 张
                </DropdownMenuItem>
              ))}
            </>
          )}

          {onBatchTags && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={selectedCount === 0}
                onSelect={() => onBatchTags()}
              >
                <Tags className="mr-2 h-3.5 w-3.5" />
                批量标签{selectedCount > 0 ? ` (${selectedCount})` : ''}
              </DropdownMenuItem>
            </>
          )}

          {(onDeleteSelected || onDeleteAll) && (
            <>
              <DropdownMenuSeparator />
              {onDeleteSelected && (
                <DropdownMenuItem
                  disabled={selectedCount === 0}
                  className="text-destructive focus:text-destructive"
                  onSelect={() => onDeleteSelected()}
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  删除所选{selectedCount > 0 ? ` (${selectedCount})` : ''}
                </DropdownMenuItem>
              )}
              {onDeleteAll && (
                <DropdownMenuItem
                  disabled={totalCount === 0}
                  className="text-destructive focus:text-destructive"
                  onSelect={() => onDeleteAll()}
                >
                  <Eraser className="mr-2 h-3.5 w-3.5" />
                  全部删除
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex shrink-0 items-center gap-1.5">
        {onViewChange && (
          <Segmented
            size="sm"
            ariaLabel="视图"
            value={view}
            onChange={onViewChange}
            options={[
              { value: 'grid', label: <LayoutGrid className="h-3.5 w-3.5" />, title: '网格视图' },
              { value: 'wall', label: <Wallpaper className="h-3.5 w-3.5" />, title: '照片墙' },
            ]}
          />
        )}

        {onColumnsChange && (
          <Select value={String(columns)} onValueChange={(v) => onColumnsChange(Number(v))}>
            <SelectTrigger className="h-8 w-[72px] rounded-full" title="每行几张">
              <Grid2x2 className="mr-1 h-3.5 w-3.5 text-ink-faint" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COLUMN_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} 列
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={filter} onValueChange={(v) => onFilterChange(v as PhotoFilter)}>
          <SelectTrigger className="h-8 w-[86px] rounded-full" title="筛选">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FILTER_ORDER.map((key) => (
              <SelectItem key={key} value={key}>
                {PHOTO_FILTER_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
