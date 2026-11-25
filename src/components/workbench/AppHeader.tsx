// src/components/workbench/AppHeader.tsx
// 项目工作台顶栏。0.5.1：改成玻璃条 + 面包屑式标题，返回按钮做成圆形，
// 右侧动作合并成「设置（图标）」+「导出成书（实心）」两个层级。

'use client';

import { useState } from 'react';
import { ArrowLeft, Download, PenLine, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface AppHeaderProps {
  projectName: string;
  onBack: () => void;
  onRename: (name: string) => void;
  onOpenSettings: () => void;
  /** 0.7.7：项目里直接改「怎么写」（标题风格 / 叙事笔法 / 故事长度） */
  onOpenStyle: () => void;
  onExport: () => void;
}

export function AppHeader({
  projectName,
  onBack,
  onRename,
  onOpenSettings,
  onOpenStyle,
  onExport,
}: AppHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(projectName);

  const startEditing = (): void => {
    setDraft(projectName);
    setEditing(true);
  };

  const commit = (): void => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== projectName) onRename(trimmed);
    setEditing(false);
  };

  const cancel = (): void => {
    setDraft(projectName);
    setEditing(false);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-line/45" data-glass-bar>
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-5 md:px-6">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回项目列表"
          className="ps-pressable flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-mid transition-colors duration-200 hover:bg-ink/6 hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        {editing ? (
          <Input
            value={draft}
            autoFocus
            maxLength={40}
            className="h-8 max-w-xs"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') cancel();
            }}
          />
        ) : (
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="hidden text-[11px] text-ink-faint sm:inline">项目</span>
            <h1
              className="cursor-text truncate text-[14px] font-semibold tracking-[-0.01em] text-ink"
              title="双击重命名"
              onDoubleClick={startEditing}
            >
              {projectName}
            </h1>
          </div>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {/* 0.7.7：改「怎么写」不必再退回全局设置页 */}
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-2.5 text-ink-mid"
            onClick={onOpenStyle}
            title="写法：标题风格、叙事笔法、故事长度"
          >
            <PenLine className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">写法</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 rounded-full px-2.5 text-ink-mid"
            onClick={onOpenSettings}
            title="生成设置"
          >
            <Settings className="h-4 w-4 sm:mr-1.5" />
            <span className="hidden sm:inline">设置</span>
          </Button>
          <Button
            size="sm"
            className="h-8 rounded-full px-3.5"
            onClick={onExport}
            title="导出为 Word / PPT / PDF 成书"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            导出成书
          </Button>
        </div>
      </div>
    </header>
  );
}
