// src/components/command-palette.tsx
// 0.4.1：命令面板（Ctrl+K）。搜索页面 / 项目，回车直达。
// 0.5.1：改为 Radix Dialog 驱动，获得统一的开合动效与焦点管理。

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  BookOpen,
  BookOpenCheck,
  ChartLine,
  Compass,
  CornerDownLeft,
  FlaskConical,
  Gauge,
  Gavel,
  Images,
  Image as ImageIcon,
  LayoutGrid,
  LayoutTemplate,
  ScrollText,
  Search,
  Settings,
  Sparkles,
  Swords,
  Trash2,
} from 'lucide-react';

import { ROUTES } from '@/config/app';
import { PhotoRepository, ProjectRepository } from '@/lib/db';
import { cn } from '@/lib/utils';
import type { Photo, ProjectSummary } from '@/types/domain';

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  group: '页面' | '项目' | '照片' | '操作';
  href?: string;
  icon: typeof LayoutGrid;
  run?: () => void;
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  const [cursor, setCursor] = useState(0);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setKeyword('');
    setCursor(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40);

    void (async () => {
      try {
        setProjects((await ProjectRepository.list()).slice(0, 40));
      } catch {
        setProjects([]);
      }
      // 0.5.6：顺带把照片标题捞进来，能直接搜到「那张图」
      try {
        const rows = await PhotoRepository.listAll();
        setPhotos(rows.filter((row) => row.status === 'success').slice(0, 400));
      } catch {
        setPhotos([]);
      }
    })();

    return () => window.clearTimeout(timer);
  }, [open]);

  const items = useMemo<CommandItem[]>(() => {
    const pages: CommandItem[] = [
      { id: 'home', label: '主菜单', group: '页面', href: ROUTES.home, icon: Sparkles },
      { id: 'projects', label: '项目', group: '页面', href: ROUTES.projects, icon: LayoutGrid },
      { id: 'gallery', label: '照片库', group: '页面', href: ROUTES.gallery, icon: Images, hint: '所有照片，一眼看完' },
      { id: 'score', label: '评分', group: '页面', href: ROUTES.score, icon: Gauge, hint: '给照片打分，指出短板' },
      { id: 'book', label: '编排成书', group: '页面', href: ROUTES.book, icon: BookOpen, hint: '决定哪张在前、哪张在后' },
      { id: 'lab', label: '文案实验室', group: '页面', href: ROUTES.lab, icon: FlaskConical, hint: '同一张照片，四种写法' },
      { id: 'themes', label: '主题馆', group: '页面', href: ROUTES.themes, icon: Compass, hint: '按题材成套地看片' },
      { id: 'compare', label: '选片擂台', group: '页面', href: ROUTES.compare, icon: Swords, hint: '两两对打，选出心头好' },
      { id: 'review', label: '评审室', group: '页面', href: ROUTES.review, icon: Gavel, hint: '三位评委，三个视角' },
      { id: 'growth', label: '摄影档案', group: '页面', href: ROUTES.growth, icon: ChartLine, hint: '你的拍摄习惯长什么样' },
      { id: 'studio', label: '排版台', group: '页面', href: ROUTES.studio, icon: LayoutTemplate, hint: '这一页哪块在哪，你说了算' },
      { id: 'flip', label: '翻页预览', group: '页面', href: ROUTES.flip, icon: BookOpenCheck, hint: '印之前先翻一遍' },
      { id: 'trash', label: '回收站', group: '页面', href: ROUTES.trash, icon: Trash2, hint: '删掉的照片先来这里' },
      { id: 'changelog', label: '更新日志', group: '页面', href: ROUTES.changelog, icon: ScrollText },
      { id: 'settings', label: '设置', group: '页面', href: ROUTES.settings, icon: Settings },
    ];

    const projectItems: CommandItem[] = projects.map((p) => ({
      id: 'p-' + p.id,
      label: p.name,
      hint: p.photoCount + ' 张',
      group: '项目',
      href: ROUTES.project(p.id),
      icon: LayoutGrid,
    }));

    const actions: CommandItem[] = [
      {
        id: 'new-project',
        label: '新建项目',
        hint: 'Ctrl+N',
        group: '操作',
        icon: LayoutGrid,
        run: () => router.push(ROUTES.projects),
      },
      {
        id: 'quick-score',
        label: '去评分页补分',
        group: '操作',
        icon: Gauge,
        run: () => router.push('/score'),
      },
      {
        id: 'go-studio',
        label: '去排版台摆版式',
        hint: 'A4 画布 · 积木自己摆',
        group: '操作',
        icon: LayoutTemplate,
        run: () => router.push(ROUTES.studio),
      },
      {
        id: 'go-book',
        label: '去编排分章节',
        group: '操作',
        icon: BookOpen,
        run: () => router.push(ROUTES.book),
      },
      {
        id: 'go-trash',
        label: '打开回收站',
        hint: '恢复删掉的照片',
        group: '操作',
        icon: Trash2,
        run: () => router.push(ROUTES.trash),
      },
    ];

    // 0.5.6：照片也能搜——命中标题、标签或文件名都算
    const projectNames = new Map(projects.map((p) => [p.id, p.name]));
    const photoItems: CommandItem[] = photos.map((photo) => ({
      id: 'ph-' + photo.id,
      label: photo.analysis?.title?.trim() || photo.fileName,
      hint: [
        projectNames.get(photo.projectId) ?? '项目',
        photo.analysis?.score ? Math.round(photo.analysis.score.overall) + ' 分' : null,
        (photo.analysis?.tags ?? []).slice(0, 2).join(' '),
      ]
        .filter(Boolean)
        .join(' · '),
      group: '照片',
      href: ROUTES.project(photo.projectId) + '?photo=' + photo.id,
      icon: ImageIcon,
    }));

    return [...actions, ...pages, ...projectItems, ...photoItems];
  }, [photos, projects, router]);

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items.slice(0, 12);
    return items
      .filter((item) => (item.label + (item.hint ?? '')).toLowerCase().includes(kw))
      .slice(0, 12);
  }, [items, keyword]);

  useEffect(() => {
    setCursor(0);
  }, [keyword]);

  const choose = (item: CommandItem | undefined): void => {
    if (!item) return;
    onOpenChange(false);
    if (item.run) item.run();
    else if (item.href) router.push(item.href);
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/30 px-4 pt-[15vh] backdrop-blur-[3px]"
      style={{ animation: 'ps-fade-in 200ms var(--ease-out) both' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        role="dialog"
        aria-label="命令面板"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-line/70 bg-popover/97 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
        style={{ animation: 'ps-dialog-panel-in 260ms var(--ease-spring) both' }}
      >
        <div className="flex items-center gap-2.5 border-b border-line/50 px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                onOpenChange(false);
              } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(filtered[cursor]);
              }
            }}
            placeholder="搜索页面、项目，或直接输入命令…"
            className="h-7 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint"
          />
          <kbd className="rounded-md border border-line/70 bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
            Esc
          </kbd>
        </div>

        <div className="max-h-[46vh] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <p className="px-3 py-10 text-center text-[12.5px] text-ink-faint">没有匹配项</p>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon;
              const active = index === cursor;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => choose(item)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-[background-color,color] duration-[160ms] ease-[var(--ease-out)]',
                    active ? 'bg-ink text-paper' : 'text-ink-mid hover:bg-ink/[0.05] hover:text-ink',
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0 transition-transform duration-[var(--dur-3)] ease-[var(--ease-spring)]',
                      active && 'scale-110',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
                    {item.label}
                  </span>
                  {item.hint && (
                    <span
                      className={cn(
                        'shrink-0 text-[10.5px] tabular-nums',
                        active ? 'text-paper/70' : 'text-ink-faint',
                      )}
                    >
                      {item.hint}
                    </span>
                  )}
                  <span
                    className={cn(
                      'shrink-0 rounded-full px-1.5 py-[1px] text-[9.5px]',
                      active ? 'bg-paper/15 text-paper/70' : 'bg-surface-2 text-ink-faint',
                    )}
                  >
                    {item.group}
                  </span>
                  {active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0" />}
                </button>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line/50 px-3.5 py-2 text-[10.5px] text-ink-faint">
          <span>↑↓ 选择 · Enter 打开</span>
          <span className="tabular-nums">Ctrl+K 随时唤起</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
