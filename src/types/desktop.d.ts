// src/types/desktop.d.ts
// Electron preload 注入的桌面 API 类型声明。

export interface DesktopPaths {
  userData: string;
  dataDir: string;
  downloads: string;
}

export interface PdfExportResult {
  ok: boolean;
  filePath?: string;
  canceled?: boolean;
  error?: string;
}

declare global {
  interface Window {
    photoStory?: {
      isDesktop: boolean;
      versions: { electron: string; chrome: string; node: string };
      getPaths: () => Promise<DesktopPaths>;
      openPath: (target: string) => Promise<{ ok: boolean; message?: string }>;
      exportPdf: (payload: {
        html: string;
        defaultName?: string;
        /** 0.5.4：设置里指定的固定导出目录，给了就直接写进去 */
        dir?: string;
        /** 0.5.4：纸张与版心，按设置传给 printToPDF（不给则退回 A4 默认边距） */
        pageSize?: 'A4' | 'A5';
        landscape?: boolean;
        marginMm?: number;
        gutterMm?: number;
      }) => Promise<PdfExportResult>;
      /** 0.3.4：同步原生标题栏明暗 */
      setThemeSource?: (mode: 'system' | 'light' | 'dark') => Promise<{ ok: boolean }>;
      /** 0.3.4：设置里的应用操作 */
      reload?: () => Promise<void>;
      toggleDevTools?: () => Promise<void>;
      setZoom?: (factor: number) => Promise<number>;
      getZoom?: () => Promise<number>;
      /** 0.3.6：启动卸载程序 */
      uninstall?: () => Promise<{ ok: boolean; path?: string; message?: string }>;
      /** 0.5.4：挑选固定的导出目录 */
      chooseDirectory?: (
        current?: string,
      ) => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>;
      /** 0.5.4：把文档直接写进固定目录（同名自动加序号） */
      saveToDirectory?: (payload: {
        dir: string;
        fileName: string;
        data: Uint8Array;
      }) => Promise<{ ok: boolean; path?: string; error?: string }>;
      /** 在资源管理器里选中该文件 */
      showItemInFolder?: (target: string) => Promise<{ ok: boolean; error?: string }>;
    };
  }
}
