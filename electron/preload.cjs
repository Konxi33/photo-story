// electron/preload.cjs
// 只暴露必要的桌面能力：版本、路径、打开文件夹、导出 PDF、主题同步、应用操作。
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('photoStory', {
  isDesktop: true,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  /** 获取应用数据目录（配置与数据库所在位置） */
  getPaths: () => ipcRenderer.invoke('app:paths'),
  /** 在资源管理器中打开目录 */
  openPath: (target) => ipcRenderer.invoke('app:openPath', target),
  /** 用 Chromium 渲染 HTML 并导出 PDF，返回 { ok, canceled?, filePath? , error? } */
  exportPdf: (payload) => ipcRenderer.invoke('export:pdf', payload),
  /** 同步原生标题栏的明暗（跟随系统/浅色/深色） */
  setThemeSource: (mode) => ipcRenderer.invoke('app:setThemeSource', mode),
  /** 设置页里的应用操作 */
  reload: () => ipcRenderer.invoke('app:reload'),
  toggleDevTools: () => ipcRenderer.invoke('app:toggleDevTools'),
  setZoom: (factor) => ipcRenderer.invoke('app:setZoom', factor),
  getZoom: () => ipcRenderer.invoke('app:getZoom'),
  /** 启动卸载程序（仅安装版可用） */
  uninstall: () => ipcRenderer.invoke('app:uninstall'),
  /** 0.5.4：选一个固定的导出文件夹，返回 { ok, path } 或 { ok:false, canceled:true } */
  chooseDirectory: (current) => ipcRenderer.invoke('app:chooseDirectory', current),
  /** 0.5.4：把文档直接写进固定目录，返回 { ok, path } */
  saveToDirectory: (payload) => ipcRenderer.invoke('file:saveToDirectory', payload),
  /** 在资源管理器里选中该文件 */
  showItemInFolder: (target) => ipcRenderer.invoke('app:showItemInFolder', target),
});
