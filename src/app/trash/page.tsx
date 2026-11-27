'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

import { AppShell } from '@/components/app-shell';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { AssetRepository, PhotoRepository, ProjectRepository } from '@/lib/db/repository';
import type { Photo } from '@/types/domain';

interface TrashRow {
  photo: Photo;
  projectName: string;
  url?: string;
}

function formatStamp(value: number | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function TrashPage() {
  const [rows, setRows] = useState<TrashRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [photos, projects] = await Promise.all([
        PhotoRepository.listDeleted(),
        ProjectRepository.list(),
      ]);
      const names = new Map(projects.map((item) => [item.id, item.name]));
      const next: TrashRow[] = [];
      for (const photo of photos) {
        let url: string | undefined;
        try {
          const asset = await AssetRepository.get(photo.id, 'preview');
          if (asset) url = URL.createObjectURL(asset.blob);
        } catch {
          // 缩略图缺失就不显示，不影响恢复
        }
        next.push({ photo, projectName: names.get(photo.projectId) ?? '已删除的项目', url });
      }
      setRows((prev) => {
        prev.forEach((row) => row.url && URL.revokeObjectURL(row.url));
        return next;
      });
    } catch (error) {
      toast.error('读取回收站失败', { description: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      setRows((prev) => {
        prev.forEach((row) => row.url && URL.revokeObjectURL(row.url));
        return [];
      });
    };
  }, [load]);

  const totalSize = useMemo(
    () => rows.reduce((sum, row) => sum + (row.photo.fileSize || 0), 0),
    [rows],
  );

  const handleRestore = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await PhotoRepository.restore(ids);
      await load();
      toast.success('已恢复 ' + ids.length + ' 张', { description: '照片回到原来的项目里了' });
    } catch (error) {
      toast.error('恢复失败', { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const handlePurge = async (ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await PhotoRepository.purge(ids);
      await load();
      toast.success('已彻底删除 ' + ids.length + ' 张', { description: '这一步不能撤销' });
    } catch (error) {
      toast.error('彻底删除失败', { description: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      actions={
        rows.length > 0 ? (
          <div className="flex items-center gap-2">
            <Button
              disabled={busy}
              onClick={() => void handleRestore(rows.map((row) => row.photo.id))}
              size="sm"
              variant="ghost"
            >
              <Undo2 className="size-4" />
              全部恢复
            </Button>
            <Button
              disabled={busy}
              onClick={() => setConfirmOpen(true)}
              size="sm"
              variant="ghost"
            >
              <Trash2 className="size-4" />
              清空
            </Button>
          </div>
        ) : null
      }
    >
      <div className="mx-auto grid w-full max-w-5xl gap-5 px-5 py-8 md:px-8">
        <header className="grid gap-1.5">
          <h1 className="ps-page-title">回收站</h1>
          <p className="ps-page-desc">
            删除的照片会先来这里，随时能恢复。确认不要了再彻底删除——
            那一步才真的把图片从磁盘上抹掉。
          </p>
        </header>

        {loading ? (
          <div className="grid gap-3">
            {[0, 1, 2].map((index) => (
              <div className="ps-skeleton h-[86px] rounded-2xl" key={index} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="grid justify-items-center gap-3 rounded-2xl border border-line/60 bg-surface/40 px-6 py-16 text-center">
            <Trash2 className="size-7 text-ink-faint" />
            <p className="text-[13px] text-ink-soft">回收站是空的。</p>
            <p className="text-[11.5px] text-ink-faint">
              在项目里删照片时，它们会先落到这里，8 秒内还能一键撤销。
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-[12px] text-ink-soft">
              <span className="tabular-nums">{rows.length} 张</span>
              <span className="text-ink-faint">·</span>
              <span className="tabular-nums">{(totalSize / 1024 / 1024).toFixed(1)} MB</span>
              <span className="text-ink-faint">· 恢复后会回到原来项目的原位置</span>
            </div>

            <ul className="grid gap-2">
              {rows.map((row) => (
                <li
                  className="flex items-center gap-4 rounded-2xl border border-line/60 bg-surface/40 p-3 transition-colors duration-200 hover:bg-surface/70"
                  key={row.photo.id}
                >
                  <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-ink/6">
                    {row.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={row.photo.fileName}
                        className="size-full object-cover"
                        src={row.url}
                      />
                    ) : (
                      <span className="text-[10px] text-ink-faint">无预览</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-ink">
                      {row.photo.analysis?.title?.trim() || row.photo.fileName}
                    </p>
                    <p className="mt-0.5 truncate text-[11.5px] text-ink-faint">
                      {row.projectName} · 删除于 {formatStamp(row.photo.deletedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      aria-label={'恢复 ' + row.photo.fileName}
                      disabled={busy}
                      onClick={() => void handleRestore([row.photo.id])}
                      size="sm"
                      variant="ghost"
                    >
                      <RotateCcw className="size-4" />
                      恢复
                    </Button>
                    <Button
                      aria-label={'彻底删除 ' + row.photo.fileName}
                      disabled={busy}
                      onClick={() => void handlePurge([row.photo.id])}
                      size="sm"
                      variant="ghost"
                    >
                      <Trash2 className="size-4" />
                      彻底删除
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空回收站？</AlertDialogTitle>
            <AlertDialogDescription>
              这会彻底删除 {rows.length} 张照片和它们的原图、预览，无法撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                void handlePurge(rows.map((row) => row.photo.id));
              }}
            >
              彻底删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
