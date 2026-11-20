// src/app/projects/page.tsx
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  Download,
  Package,
  FolderOpen,
  HardDrive,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';

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
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { FadeImg } from '@/components/ui/fade-img';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  APP_DESCRIPTION,
  DEFAULT_EXPORT_SETTINGS,
  ROUTES,
} from '@/config/app';
import { downloadBackup, exportProjectBackup, importProjectBackup } from '@/lib/backup';
import {
  downloadZpgs,
  exportProjectToZpgs,
  importProjectFromZpgs,
} from '@/lib/package/zpgs';
import { AssetRepository, ProjectRepository } from '@/lib/db';
import { repairInterruptedPhotos } from '@/lib/db/repair';
import { getStorageUsage } from '@/lib/storage/usage';
import { cn, formatBytes, formatDate, randomId } from '@/lib/utils';
import { DOMAIN_SCHEMA_VERSION } from '@/types/domain';
import type { Project, ProjectSummary, StorageUsage } from '@/types/domain';

/** IndexedDB 卡住时不要让页面一直转圈 */
const LOAD_TIMEOUT_MS = 5000;

export default function ProjectsPage() {
  const router = useRouter();

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const [renameTarget, setRenameTarget] = useState<ProjectSummary | null>(null);
  const [renameName, setRenameName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const list = await Promise.race([
        ProjectRepository.list(),
        new Promise<ProjectSummary[]>((resolve) =>
          setTimeout(() => resolve([]), LOAD_TIMEOUT_MS),
        ),
      ]);
      setProjects(list);
    } catch (error) {
      toast.error('读取项目列表失败', { description: (error as Error).message });
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      // 中断修复不能阻塞列表加载：IndexedDB 慢或被锁时会一直等下去
      void repairInterruptedPhotos().catch(() => undefined);
      await refresh();
      setUsage(await getStorageUsage().catch(() => null));
    })();
  }, [refresh]);

  // 0.6.4：批量识别时，本机同一个源上的长请求会把浏览器的连接占满，
  // 这时点项目卡要等好几秒到几十秒才跳（用户感受就是「点项目进不去」）。
  // 列表出来后就把每个项目页的 RSC 载荷预先取回来，点进去直接用缓存，不再等网络。
  useEffect(() => {
    if (!projects || projects.length === 0) return;
    projects.slice(0, 24).forEach((project) => {
      router.prefetch(ROUTES.project(project.id));
    });
  }, [projects, router]);

  const handleCreate = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('请输入项目名');
      return;
    }

    setCreating(true);
    try {
      const project: Project = {
        id: randomId(),
        name: trimmed,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        exportSettings: { ...DEFAULT_EXPORT_SETTINGS },
        schemaVersion: DOMAIN_SCHEMA_VERSION,
      };
      await ProjectRepository.create(project);
      setName('');
      setOpen(false);
      router.push(ROUTES.project(project.id));
    } catch (error) {
      toast.error('创建项目失败', { description: (error as Error).message });
    } finally {
      setCreating(false);
    }
  };

  const handleRename = async (): Promise<void> => {
    const trimmed = renameName.trim();
    if (!renameTarget || !trimmed) {
      toast.error('请输入项目名');
      return;
    }
    try {
      await ProjectRepository.rename(renameTarget.id, trimmed);
      setRenameTarget(null);
      await refresh();
      toast.success('已重命名');
    } catch (error) {
      toast.error('重命名失败', { description: (error as Error).message });
    }
  };

  const handleDeleteProject = async (): Promise<void> => {
    if (!deleteTarget) return;
    try {
      await ProjectRepository.delete(deleteTarget.id);
      setDeleteTarget(null);
      await refresh();
      toast.success('项目已删除', { description: '照片与图片资源已一并清理' });
    } catch (error) {
      toast.error('删除失败', { description: (error as Error).message });
    }
  };

  const handleBackup = async (target: ProjectSummary): Promise<void> => {
    try {
      const json = await exportProjectBackup(target.id);
      if (!json) throw new Error('项目不存在');
      downloadBackup(json, target.name);
      toast.success('备份已生成', {
        description: '包含 ' + target.photoCount + ' 张照片的原图与生成内容',
      });
    } catch (error) {
      toast.error('备份失败', { description: (error as Error).message });
    }
  };

  /** 0.3.4：打包成 .zpgs，可拿到另一台电脑打开 */
  const handleExportZpgs = async (target: ProjectSummary): Promise<void> => {
    try {
      const result = await exportProjectToZpgs(target.id);
      if (!result) throw new Error('项目不存在');
      downloadZpgs(result.blob, result.fileName);
      toast.success('项目包已生成', {
        description: target.photoCount + ' 张照片 · 可在另一台电脑用「打开项目包」导入',
      });
    } catch (error) {
      toast.error('打包失败', { description: (error as Error).message });
    }
  };

  const handleImportFile = async (file: File | null): Promise<void> => {
    if (!file || importing) return;
    setImporting(true);
    try {
      // .zpgs 是二进制项目包，JSON 是旧版备份，按扩展名分流
      if (file.name.toLowerCase().endsWith('.zpgs')) {
        const result = await importProjectFromZpgs(file);
        await refresh();
        toast.success('项目包已打开', {
          description: result.projectName + ' · ' + result.photoCount + ' 张照片',
        });
        router.push(ROUTES.project(result.projectId));
      } else {
        const text = await file.text();
        const result = await importProjectBackup(text);
        await refresh();
        toast.success('导入成功', { description: '已恢复 ' + result.photoCount + ' 张照片' });
        router.push(ROUTES.project(result.projectId));
      }
    } catch (error) {
      toast.error('导入失败', { description: (error as Error).message });
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const totalPhotos = (projects ?? []).reduce((sum, p) => sum + p.photoCount, 0);

  return (
    <AppShell
      actions={
        <Button
          variant="ghost"
          size="sm"
          className="ps-pressable shrink-0 text-ink-mid"
          disabled={importing}
          onClick={() => importInputRef.current?.click()}
        >
          {importing ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-1.5 h-4 w-4" />
          )}
          <span className="hidden sm:inline">导入备份</span>
        </Button>
      }
    >
    <div className="mx-auto w-full max-w-5xl px-5 pb-10 md:px-8">

      <input
        ref={importInputRef}
        type="file"
        accept=".zpgs,.json,application/json,application/zip"
        className="hidden"
        onChange={(e) => void handleImportFile(e.target.files?.[0] ?? null)}
      />

      {/* Hero */}
      <header className="pt-12 pb-9">
        <p className="ps-enter ps-eyebrow" style={{ ['--ps-delay' as string]: '0ms' }}>
          Photo Story
        </p>
        <h1
          className="ps-enter ps-display mt-3 text-[30px] text-ink sm:text-[40px]"
          style={{ ['--ps-delay' as string]: '60ms' }}
        >
          把照片，写成一册
        </h1>
        <p
          className="ps-enter mt-3.5 max-w-[34rem] text-[13.5px] leading-relaxed break-words text-ink-mid"
          style={{ ['--ps-delay' as string]: '120ms' }}
        >
          {APP_DESCRIPTION}。挑一组照片交给它，写标题、故事与拍摄手法，最后排成一册 Word。
        </p>

        <div
          className="ps-enter mt-7 flex flex-wrap items-center gap-2.5"
          style={{ ['--ps-delay' as string]: '180ms' }}
        >
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="lg" className="h-10 px-5">
                <Plus className="mr-1.5 h-4 w-4" />
                新建项目
              </Button>
            </DialogTrigger>

            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>新建项目</DialogTitle>
                <DialogDescription>给这段照片一个名字，之后可以随时改。</DialogDescription>
              </DialogHeader>

              <div className="grid gap-2 py-2">
                <Label htmlFor="project-name">项目名</Label>
                <Input
                  id="project-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：2026 秋 · 皖南"
                  maxLength={40}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleCreate();
                  }}
                />
              </div>

              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={creating}>
                  取消
                </Button>
                <Button onClick={() => void handleCreate()} disabled={creating}>
                  {creating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                  确定
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Button
            size="lg"
            variant="outline"
            className="h-10 px-5"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
          >
            <Upload className="mr-1.5 h-4 w-4" />
            导入备份
          </Button>

          <span className="ml-1 text-[11.5px] text-ink-faint tabular-nums">
            {totalPhotos > 0
              ? `${projects?.length ?? 0} 个项目 · ${totalPhotos} 张照片`
              : '所有数据只存在这台电脑'}
          </span>
        </div>
      </header>

      {/* 列表 */}
      <section className="flex-1">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="ps-eyebrow">我的项目</h2>
          <span className="text-[11px] text-ink-faint tabular-nums">
            {projects === null ? '读取中…' : `共 ${projects.length} 个`}
          </span>
        </div>

        {projects === null ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="overflow-hidden rounded-[14px] border border-line/60">
                <div className="ps-skeleton aspect-16/10" />
                <div className="space-y-2 p-4">
                  <div className="ps-skeleton h-3 w-1/2 rounded" />
                  <div className="ps-skeleton h-2.5 w-1/3 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            onCreate={() => setOpen(true)}
            onImport={() => importInputRef.current?.click()}
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project, index) => (
              <ProjectCard
                key={project.id}
                project={project}
                index={index}
                onOpen={() => router.push(ROUTES.project(project.id))}
                onRename={() => {
                  setRenameTarget(project);
                  setRenameName(project.name);
                }}
                onBackup={() => void handleBackup(project)}
                onPackage={() => void handleExportZpgs(project)}
                onDelete={() => setDeleteTarget(project)}
              />
            ))}
          </div>
        )}
      </section>

      {/* 重命名 */}
      <Dialog open={renameTarget !== null} onOpenChange={(v) => !v && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>重命名项目</DialogTitle>
            <DialogDescription>改完点确定，立即生效。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-2">
            <Label htmlFor="rename-name">项目名</Label>
            <Input
              id="rename-name"
              value={renameName}
              maxLength={40}
              autoFocus
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              取消
            </Button>
            <Button onClick={() => void handleRename()}>确定</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除项目「{deleteTarget?.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              项目里的 {deleteTarget?.photoCount ?? 0} 张照片、生成的内容与图片资源会一并删除，无法恢复。建议先备份。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDeleteProject()}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 页脚 */}
      <footer className="mt-14 border-t border-line/50 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-ink-faint">
          <span className="inline-flex items-center gap-1.5">
            <HardDrive className="h-3 w-3" />
            本地存储
          </span>
          {usage && usage.quota > 0 ? (
            <div className="flex items-center gap-2.5">
              <div className="h-[3px] w-36 overflow-hidden rounded-full bg-ink/8">
                <div
                  className="h-full rounded-full bg-ink/45 transition-[width] duration-700 ease-[var(--ease-out)]"
                  style={{
                    width: `max(4px, ${Math.min(100, Math.round((usage.usage / usage.quota) * 100))}%)`,
                  }}
                />
              </div>
              <span className="tabular-nums">
                已用 {formatBytes(usage.usage)} / 可用约 {formatBytes(usage.quota)}
              </span>
            </div>
          ) : (
            <span>统计中…</span>
          )}
        </div>
      </footer>
    </div>
    </AppShell>
  );
}

/* -------------------------------- 项目卡片 ------------------------------- */

function ProjectCard({
  project,
  index,
  onOpen,
  onRename,
  onBackup,
  onPackage,
  onDelete,
}: {
  project: ProjectSummary;
  index: number;
  onOpen: () => void;
  onRename: () => void;
  onBackup: () => void;
  onPackage: () => void;
  onDelete: () => void;
}) {
  const isComplete = project.successCount >= project.photoCount && project.photoCount > 0;
  return (
    <article
      className="ps-enter group relative overflow-hidden rounded-[14px] border border-line/60 bg-surface transition-[transform,box-shadow,border-color] duration-[380ms] ease-[var(--ease-out)] hover:-translate-y-1 hover:border-ink/15 hover:shadow-[var(--elev-hover)]"
      style={{ ['--ps-delay' as string]: `${120 + index * 55}ms` }}
    >
      {/* 0.6.4 修：整张卡改成真正的链接。重生成进行中时 React 的 onClick 偶发丢失，
          以前靠 onClick 跳转就会「点项目进不去」；链接由浏览器兜底，点了就一定能进。 */}
      <Link
        href={ROUTES.project(project.id)}
        aria-label={`打开项目 ${project.name}`}
        className="block cursor-pointer rounded-[14px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink/40"
      >
      <div className="relative aspect-16/10 overflow-hidden bg-surface-2">
        <ProjectCover coverPhotoId={project.coverPhotoId} fallback={project.name} />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/72 via-black/22 to-transparent px-4 pt-12 pb-3">
          <h3 className="truncate text-[16px] font-semibold tracking-[-0.01em] text-white drop-shadow-sm">
            {project.name}
          </h3>
        </div>

        {/* 0.4.2：封面底部进度条——不用点进去就知道这个项目做完了没有 */}
        {project.photoCount > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[3px] bg-white/25"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={project.photoCount}
            aria-valuenow={project.successCount}
            aria-label="生成进度"
          >
            <span
              className="h-full bg-emerald-400 transition-[width] duration-500"
              style={{ width: `${(project.successCount / project.photoCount) * 100}%` }}
            />
            <span
              className="h-full bg-red-400 transition-[width] duration-500"
              style={{ width: `${(project.failedCount / project.photoCount) * 100}%` }}
            />
          </div>
        )}

        <span className="pointer-events-none absolute top-2.5 left-2.5 flex h-6 -translate-y-1 items-center gap-1 rounded-md bg-black/40 px-2 text-[10.5px] text-white opacity-0 backdrop-blur-sm transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          打开
          <ArrowUpRight className="h-3 w-3" />
        </span>
      </div>

      <div className="flex items-center gap-2 px-4 py-3">
        <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-ink-mid tabular-nums">
          {project.photoCount} 张
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[11px] tabular-nums',
            isComplete ? 'text-ink-faint' : 'text-amber-600 dark:text-amber-500',
          )}
        >
          <i
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              isComplete ? 'bg-emerald-500' : 'bg-amber-500',
            )}
          />
          {isComplete ? '全部完成' : `完成 ${project.successCount}/${project.photoCount}`}
        </span>
        {project.failedCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
            <i className="h-1.5 w-1.5 rounded-full bg-red-500" />
            失败 {project.failedCount}
          </span>
        )}
        <span className="ml-auto text-[11px] text-ink-faint tabular-nums">
          {formatDate(project.updatedAt)}
        </span>
        <ArrowUpRight className="h-3.5 w-3.5 text-ink-faint opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:opacity-100" />
      </div>
      </Link>

      <div className="absolute top-2.5 right-2.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`${project.name} 的更多操作`}
              className="h-7 w-7 rounded-md bg-black/35 text-white opacity-0 backdrop-blur-sm transition-all duration-300 group-hover:opacity-100 hover:bg-black/55"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onOpen}>打开</DropdownMenuItem>
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              重命名
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onBackup}>
              <Download className="mr-2 h-3.5 w-3.5" />
              备份
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onPackage}>
              <Package className="mr-2 h-3.5 w-3.5" />
              打包为 .zpgs
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onDelete}>
              <Trash2 className="mr-2 h-3.5 w-3.5" />
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

function ProjectCover({ coverPhotoId, fallback }: { coverPhotoId?: string; fallback: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!coverPhotoId) return;

    let cancelled = false;
    let objectUrl: string | null = null;

    void (async () => {
      try {
        const asset = await AssetRepository.get(coverPhotoId, 'preview');
        if (!asset || cancelled) return;
        objectUrl = URL.createObjectURL(asset.blob);
        setUrl(objectUrl);
      } catch {
        // 封面读不到就用文字占位
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [coverPhotoId]);

  if (url) {
    return (
      <FadeImg
        src={url}
        alt={`${fallback} 的封面`}
        className="h-full w-full object-cover transition-transform duration-[900ms] ease-[var(--ease-out)] group-hover:scale-[1.045]"
      />
    );
  }

  // 没有封面：用项目名首字做淡色大字水印，比灰块体面
  return (
    <div className="flex h-full w-full items-center justify-center bg-surface-2">
      <span className="text-[58px] leading-none font-semibold tracking-[-0.04em] text-ink/8 select-none">
        {fallback.slice(0, 1)}
      </span>
    </div>
  );
}

function EmptyState({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <div className="ps-enter relative overflow-hidden rounded-[14px] border border-dashed border-line/80 px-8 py-16 text-center">
      <div className="relative">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-2">
          <FolderOpen className="h-5 w-5 text-ink-mid" strokeWidth={1.4} />
        </span>
        <h2 className="mt-4 text-[16px] font-semibold tracking-[-0.01em] text-ink">还没有项目</h2>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-ink-mid">
          新建一个项目，把一次旅行、一段日子的照片放进去，写成一册。
        </p>
        <p className="mx-auto mt-1.5 text-[11px] text-ink-faint">
          支持 JPG / PNG / WebP，数据只保存在这台电脑
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button size="sm" className="h-8 rounded-full px-3.5" onClick={onCreate}>
            <Plus className="mr-1.5 h-4 w-4" />
            新建第一个项目
          </Button>
          <Button size="sm" variant="outline" className="h-8 rounded-full px-3.5" onClick={onImport}>
            <Upload className="mr-1.5 h-4 w-4" />
            导入备份
          </Button>
        </div>
      </div>
    </div>
  );
}
