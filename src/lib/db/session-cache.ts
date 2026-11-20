// src/lib/db/session-cache.ts
// 0.6.4：项目页「点不进去」的根治手段。
//
// 现象：一键重生成正在往 IndexedDB 里写 20 张大图时，点项目卡进页面，
// 页面要等 `ProjectRepository.get()` 回来才肯画 —— 那个读被写事务挤在后面，
// 十几秒回不来，用户看到的就是一直停在骨架屏。
//
// 做法：项目列表页手上本来就有完整的项目对象，点开时先塞进这个内存缓存，
// 项目页一挂载立刻用缓存把标题、操作栏画出来，再去后台刷新真实数据。
// 缓存只在当前进程存活，不写入磁盘，也不影响数据一致性。

import type { Project } from '@/types/domain';

const projects = new Map<string, Project>();

export function rememberProject(project: Project): void {
  projects.set(project.id, project);
}

export function recallProject(id: string | undefined | null): Project | null {
  if (!id) return null;
  return projects.get(id) ?? null;
}

export function forgetProject(id: string): void {
  projects.delete(id);
}
