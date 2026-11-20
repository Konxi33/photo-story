// electron/main.cjs
// Electron 主进程：启动 Next.js standalone server → 等待就绪 → 打开窗口。
// 命名为 .cjs 是因为 package.json 里是 "type": "module"。

const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  shell,
  ipcMain,
  nativeTheme,
  screen,
  net,
} = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOST = '127.0.0.1';
const PORT = 3939;
const APP_URL = 'http://' + HOST + ':' + PORT;

let serverProcess = null;
let mainWindow = null;

function resolveServerEntry() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'standalone')
    : path.join(__dirname, '..', '.next', 'standalone');

  return { dir: base, entry: path.join(base, 'server.js') };
}

function startServer() {
  const resolved = resolveServerEntry();

  serverProcess = spawn(process.execPath, [resolved.entry], {
    cwd: resolved.dir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOSTNAME: HOST,
      // 配置目录固定到用户数据目录，避免 portable 版每次解压到临时目录导致 Key 丢失
      PHOTO_STORY_DATA_DIR: path.join(app.getPath('userData'), 'data'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  serverProcess.stdout?.on('data', (chunk) => {
    console.log('[next]', String(chunk).trimEnd());
  });
  serverProcess.stderr?.on('data', (chunk) => {
    console.error('[next]', String(chunk).trimEnd());
  });
  serverProcess.on('exit', (code) => {
    console.log('[next] exited with code', code);
    serverProcess = null;
  });
}

async function waitForServer(timeoutMs) {
  const limit = timeoutMs || 40000;
  const deadline = Date.now() + limit;

  while (Date.now() < deadline) {
    if (serverProcess === null) {
      throw new Error('Next.js 服务进程意外退出，请查看日志');
    }
    try {
      const res = await fetch(APP_URL + '/api/settings', {
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok || res.status === 400) return;
    } catch {
      // 还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error('Next.js 服务启动超时（40 秒）');
}

function stopServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;

  try {
    child.kill();
  } catch {
    // 忽略
  }

  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      // 忽略
    }
  }
}

function createWindow() {
  // 0.5.2：窗口尺寸按屏幕可用区域收敛。
  // 之前固定 1280×860，在 125%/150% 缩放的笔记本上（可用高度常常只有 800 左右）
  // 窗口比桌面还高，右侧和底部会被桌面直接切掉，用户必须手动拉一下窗口才会重排。
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const margin = 32;
  const width = Math.max(960, Math.min(1280, wa.width - margin));
  const height = Math.max(640, Math.min(860, wa.height - margin));

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(1024, width),
    minHeight: Math.min(700, height),
    center: true,
    useContentSize: false,
    show: false,
    autoHideMenuBar: true,
    // 0.4.0：Windows 11 亚克力背景——桌面透过窗口显示，再由 DWM 做模糊，
    // 配合 CSS 的半透明底色，才能真的「看到桌面」而不是只透明到窗口背景。
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    visualEffectState: 'active',
    title: '照片故事',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  /** 窗口是否完整落在某个显示器的可用区域内 */
  const fitsScreen = () => {
    if (!mainWindow) return true;
    const b = mainWindow.getBounds();
    const { workArea } = screen.getDisplayMatching(b);
    return (
      b.x >= workArea.x - 2 &&
      b.y >= workArea.y - 2 &&
      b.x + b.width <= workArea.x + workArea.width + 2 &&
      b.y + b.height <= workArea.y + workArea.height + 2
    );
  };

  /** 放不下就缩到可用区域内并居中（用户手动缩放过的正常尺寸不会被改） */
  const ensureInsideScreen = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (fitsScreen()) return;
    const b = mainWindow.getBounds();
    const { workArea } = screen.getDisplayMatching(b);
    const w = Math.min(b.width, workArea.width);
    const h = Math.min(b.height, workArea.height);
    mainWindow.setBounds({
      x: Math.floor(workArea.x + (workArea.width - w) / 2),
      y: Math.floor(workArea.y + (workArea.height - h) / 2),
      width: w,
      height: h,
    });
  };

  // 0.5.3：透明 + 亚克力窗口在部分机器上首帧只画了左上角一块，
  // 右侧和底部空白/被裁，用户拖动一下窗口才恢复。
  // 这里做一次「不可见的一次性重排」：把窗口尺寸 +1px 再还原，等价于用户手动拉一下，
  // 但发生在 show 之后 80ms，肉眼看不到。
  let nudged = false;
  const nudgeRepaint = () => {
    if (nudged) return;
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) return;
    if (mainWindow.isMaximized() || mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
    nudged = true;
    const b = mainWindow.getBounds();
    mainWindow.setBounds({ ...b, height: b.height + 1 });
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.setBounds(b);
    }, 40);
  };

  mainWindow.once('ready-to-show', () => {
    // 隐藏白色菜单栏，但保留菜单（快捷键仍然有效）
    mainWindow?.setMenuBarVisibility(false);
    ensureInsideScreen();
    mainWindow?.show();
    setTimeout(nudgeRepaint, 80);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    // 页面内容加载完再核对一次（此时布局尺寸才稳定）
    ensureInsideScreen();
    setTimeout(nudgeRepaint, 120);
  });
  mainWindow.setMenuBarVisibility(false);

  // 0.6.4 诊断：渲染进程卡死/崩溃时写日志，用来定位「重生成后点不进项目」
  const runtimeLog = path.join(app.getPath('userData'), 'logs');
  const writeRuntimeLog = (event, detail) => {
    try {
      fs.mkdirSync(runtimeLog, { recursive: true });
      fs.appendFileSync(
        path.join(runtimeLog, 'renderer.log'),
        `${new Date().toISOString()} ${event} ${detail ? JSON.stringify(detail) : ''}\n`,
        'utf8',
      );
    } catch {
      /* 日志失败不影响主流程 */
    }
  };
  writeRuntimeLog('boot', { version: app.getVersion() });
  mainWindow.on('unresponsive', () => writeRuntimeLog('unresponsive'));
  mainWindow.on('responsive', () => writeRuntimeLog('responsive'));
  mainWindow.webContents.on('render-process-gone', (_e, d) =>
    writeRuntimeLog('render-process-gone', { reason: d.reason, exitCode: d.exitCode }),
  );
  mainWindow.webContents.on('preload-error', (_e, p, err) =>
    writeRuntimeLog('preload-error', { p, message: err.message }),
  );
  app.on('child-process-gone', (_e, d) =>
    writeRuntimeLog('child-process-gone', { type: d.type, reason: d.reason }),
  );

  // 每 5 秒探一次渲染进程能不能执行 JS：卡死时日志里会连续出现 eval-timeout
  let lastVerdict = 'ok';
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const started = Date.now();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      if (lastVerdict !== 'timeout') {
        lastVerdict = 'timeout';
        writeRuntimeLog('eval-timeout', { ms: Date.now() - started });
      }
    }, 4000);
    mainWindow.webContents
      .executeJavaScript('1')
      .then(() => {
        settled = true;
        clearTimeout(timer);
        if (lastVerdict === 'timeout') {
          lastVerdict = 'ok';
          writeRuntimeLog('eval-ok-again');
        }
      })
      .catch(() => {
        settled = true;
        clearTimeout(timer);
      });
  }, 5000);

  mainWindow.loadURL(APP_URL);

  // 换显示器 / 改缩放比例后，窗口可能又跑到屏幕外
  screen.on('display-metrics-changed', ensureInsideScreen);
  screen.on('display-removed', ensureInsideScreen);
  mainWindow.on('maximize', () => {
    if (!fitsScreen()) ensureInsideScreen();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(APP_URL)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildMenu() {
  // 0.3.4：菜单栏不再显示（它固定白底，与深色主题冲突），
  // 但菜单本身要保留——Windows 上 Ctrl+C / Ctrl+V / Ctrl+Z 的加速键来自菜单角色。
  // 可见操作（刷新、缩放、开发者工具）已收进「设置 → 应用」。
  const template = [
    {
      label: '应用',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        // 0.3.5：不再挂 selectAll 角色。Ctrl+A 由渲染进程按「是否打开项目」决定放行，
        // 否则菜单加速键会先于页面生效，整页文字被选中。
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------ 桌面能力 IPC ----------------------------- */

/**
 * 0.3.6：确保开始菜单里有「卸载照片故事」。
 * NSIS 的 customInstall 在不同打包参数下不一定执行，这里用 Electron 自己的 API 兜底。
 */
function ensureUninstallShortcut() {
  if (!app.isPackaged) return;
  try {
    const dir = path.dirname(process.execPath);
    const uninstaller = fs
      .readdirSync(dir)
      .find((name) => /^Uninstall.*\.exe$/i.test(name));
    if (!uninstaller) return;

    const programs = path.join(
      app.getPath('appData'),
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
    );
    const link = path.join(programs, '卸载照片故事.lnk');
    if (fs.existsSync(link)) return;

    shell.writeShortcutLink(link, 'create', {
      target: path.join(dir, uninstaller),
      description: '卸载照片故事（保留照片数据）',
      cwd: dir,
    });
  } catch {
    // 没权限或路径异常时静默跳过
  }
}

/* ---------------------------- 应用内更新（0.5.7） ---------------------------- */
/*
 * 注意：这里一律走 Electron 的 net.fetch / net.request（Chromium 网络栈），
 * 不能用 Node 的 fetch / https —— 这台机器的 TLS 被中间设备接管，Node 直连
 * api.github.com 会直接 “fetch failed”。Chromium 栈能正常走系统代理与证书。
 */
/*
 * 0.5.7：不要用 /releases/latest —— GitHub 的「latest」是「最近创建」而不是「版本号最大」，
 * 补建旧版本（如 v0.3.0）会把指针改回去，实测返回 latest=0.3.0 导致永远不提示更新。
 * 改成拉列表按语义化版本取最大值。
 */
const UPDATE_RELEASES_API = 'https://api.github.com/repos/Konxi33/photo-story/releases?per_page=30';
/** GitHub 未登录请求限流 60 次/小时，1 小时内复用上次结果 */
const UPDATE_CHECK_TTL_MS = 60 * 60 * 1000;
let updateCheckCache = null; // { at: number, payload: object }

/** 只允许从官方 Release 下载，防止渲染进程被注入任意 URL 后被当成下载器 */
const UPDATE_DOWNLOAD_ALLOWLIST = [
  'https://github.com/Konxi33/photo-story/releases/download/',
  'https://objects.githubusercontent.com/',
];

function isAllowedDownloadUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  return UPDATE_DOWNLOAD_ALLOWLIST.some((prefix) => url.startsWith(prefix));
}

/** 安装包文件名只保留 ASCII 安全字符，避免路径穿越与中文名乱码 */
function sanitizeDownloadName(rawName) {
  const safe = String(rawName || '').replace(/[^A-Za-z0-9._-]/g, '');
  if (!safe || safe === '.' || safe === '..') return 'photo-story-setup.exe';
  return safe;
}

/** 解析成 [major, minor, patch]，允许 “v0.5.7” 或 “0.5.7-beta.1” */
function parseVersionParts(input) {
  const matched = String(input || '')
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!matched) return null;
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])];
}

/** a > b 返回 1，相等 0，小于 -1；解析失败按 0 处理（不会误报有新版） */
function compareVersion(a, b) {
  const left = parseVersionParts(a);
  const right = parseVersionParts(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  }
  return 0;
}

/** 在 assets 里找安装包：附件名以 -setup.exe 结尾 */
function pickSetupAsset(assets) {
  if (!Array.isArray(assets)) return null;
  const hit = assets.find(
    (asset) => asset && typeof asset.name === 'string' && /-setup\.exe$/i.test(asset.name),
  );
  if (!hit) return null;
  return {
    url: typeof hit.browser_download_url === 'string' ? hit.browser_download_url : null,
    name: hit.name,
    size: typeof hit.size === 'number' ? hit.size : null,
  };
}

/** 渲染进程的窗口可能已经销毁，webContents 也可能为 null */
function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const contents = mainWindow.webContents;
  if (!contents || contents.isDestroyed()) return;
  contents.send(channel, payload);
}

function registerIpc() {
  ipcMain.handle('app:paths', () => ({
    userData: app.getPath('userData'),
    dataDir: path.join(app.getPath('userData'), 'data'),
    downloads: app.getPath('downloads'),
  }));

  ipcMain.handle('app:openPath', async (_event, target) => {
    if (typeof target !== 'string' || !target) return { ok: false };
    const result = await shell.openPath(target);
    return { ok: result === '', message: result };
  });

  // 原生标题栏跟随应用主题（Windows 11 会一起变深/变浅）
  ipcMain.handle('app:setThemeSource', (_event, mode) => {
    const next = mode === 'dark' ? 'dark' : mode === 'light' ? 'light' : 'system';
    nativeTheme.themeSource = next;
    const dark = nativeTheme.shouldUseDarkColors;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setBackgroundColor(dark ? '#101012' : '#FBFAF7');
    }
    return { ok: true, dark };
  });

  // 设置页里的应用操作（替代原「应用 / 视图」菜单）
  ipcMain.handle('app:reload', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
  });

  ipcMain.handle('app:toggleDevTools', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.toggleDevTools();
  });

  ipcMain.handle('app:setZoom', (_event, factor) => {
    if (!mainWindow || mainWindow.isDestroyed()) return 1;
    const z = Math.min(2, Math.max(0.6, Number(factor) || 1));
    mainWindow.webContents.setZoomFactor(z);
    return z;
  });

  ipcMain.handle('app:getZoom', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return 1;
    return mainWindow.webContents.getZoomFactor();
  });

  // 0.5.4：让用户挑一个固定的导出目录（设置页里用）
  ipcMain.handle('app:chooseDirectory', async (_event, current) => {
    const fallback = app.getPath('documents');
    const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
      title: '选择导出文件夹',
      defaultPath: typeof current === 'string' && current ? current : fallback,
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '就用这里',
    });
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }
    return { ok: true, path: result.filePaths[0] };
  });

  /**
   * 0.5.4：把文档直接写进固定目录，不再弹保存框。
   * 同名文件不覆盖，自动加 (2)(3) 后缀，避免把上一次的成书冲掉。
   */
  ipcMain.handle('file:saveToDirectory', async (_event, payload) => {
    const dir = payload && typeof payload.dir === 'string' ? payload.dir.trim() : '';
    const rawName = payload && typeof payload.fileName === 'string' ? payload.fileName.trim() : '';
    const data = payload && payload.data;
    if (!dir) return { ok: false, error: '没有设置导出目录' };
    if (!rawName) return { ok: false, error: '缺少文件名' };
    if (!data) return { ok: false, error: '缺少文件内容' };

    try {
      await fs.promises.mkdir(dir, { recursive: true });
      const ext = path.extname(rawName);
      const stem = path.basename(rawName, ext);
      let target = path.join(dir, path.basename(rawName));
      let n = 1;
      while (fs.existsSync(target) && n < 500) {
        n += 1;
        target = path.join(dir, stem + ' (' + n + ')' + ext);
      }
      const buffer = Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data));
      await fs.promises.writeFile(target, buffer);
      return { ok: true, path: target };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // 在资源管理器里选中刚导出的文件
  ipcMain.handle('app:showItemInFolder', (_event, target) => {
    if (typeof target !== 'string' || !target) return { ok: false };
    if (!fs.existsSync(target)) return { ok: false, error: 'not found' };
    shell.showItemInFolder(target);
    return { ok: true };
  });

  // 0.3.6：从应用内启动卸载程序（只删程序文件与注册表，照片数据保留）
  ipcMain.handle('app:uninstall', async () => {
    const dir = path.dirname(process.execPath);
    let target = null;
    try {
      const name = fs
        .readdirSync(dir)
        .find((entry) => /^Uninstall.*\.exe$/i.test(entry));
      if (name) target = path.join(dir, name);
    } catch {
      target = null;
    }

    if (!target) {
      return { ok: false, message: '未找到卸载程序（便携版没有卸载器，直接删除文件即可）' };
    }

    spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 400);
    return { ok: true, path: target };
  });

  // 用 Chromium 排版后导出 PDF（文字仍是矢量，不是截图）
  ipcMain.handle('export:pdf', async (_event, payload) => {
    const html = payload && payload.html;
    if (typeof html !== 'string' || !html) return { ok: false, error: '缺少 HTML' };

    const tmpFile = path.join(os.tmpdir(), 'photo-story-' + Date.now() + '.html');
    let win = null;

    try {
      fs.writeFileSync(tmpFile, html, 'utf8');

      win = new BrowserWindow({
        show: false,
        width: 1240,
        height: 1754,
        webPreferences: { offscreen: true, sandbox: true, javascript: true },
      });

      await win.loadFile(tmpFile);
      // 等图片解码完成，避免 PDF 里出现空白图
      await win.webContents.executeJavaScript(
        'Promise.all(Array.from(document.images).map(function (img) { return img.decode ? img.decode().catch(function () {}) : Promise.resolve(); }))',
        true,
      ).catch(() => undefined);

      // 0.5.4：纸张、方向、页边距与装订线都跟设置走；不传则退回 A4 + 默认边距
      const mmToInch = (mm) => Math.round((Number(mm) || 0) / 25.4 * 1000) / 1000;
      const paperSize = payload && payload.pageSize === 'A5' ? 'A5' : 'A4';
      const hasMargins = payload && Number(payload.marginMm) > 0;
      const printOptions = {
        pageSize: paperSize,
        landscape: Boolean(payload && payload.landscape),
        printBackground: true,
      };
      if (hasMargins) {
        const m = mmToInch(payload.marginMm);
        printOptions.margins = {
          marginType: 'custom',
          top: m,
          bottom: m,
          // 装订线加在左边，装订后正文不被吃掉
          left: mmToInch(Number(payload.marginMm) + (Number(payload.gutterMm) || 0)),
          right: m,
        };
      } else {
        printOptions.margins = { marginType: 'default' };
      }

      const data = await win.webContents.printToPDF(printOptions);

      const defaultName =
        (payload && payload.defaultName) || '照片故事_' + Date.now() + '.pdf';

      // 0.5.4：设置里指定了固定导出目录就直接写进去，不再打扰用户选位置
      const fixedDir = payload && typeof payload.dir === 'string' ? payload.dir.trim() : '';
      if (fixedDir) {
        try {
          await fs.promises.mkdir(fixedDir, { recursive: true });
          const ext = path.extname(defaultName) || '.pdf';
          const stem = path.basename(defaultName, ext);
          let target = path.join(fixedDir, path.basename(defaultName));
          let n = 1;
          while (fs.existsSync(target) && n < 500) {
            n += 1;
            target = path.join(fixedDir, stem + ' (' + n + ')' + ext);
          }
          fs.writeFileSync(target, data);
          return { ok: true, filePath: target };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }

      const saved = await dialog.showSaveDialog({
        title: '导出 PDF',
        defaultPath: path.join(app.getPath('downloads'), defaultName),
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });

      if (saved.canceled || !saved.filePath) return { ok: false, canceled: true };

      fs.writeFileSync(saved.filePath, data);
      return { ok: true, filePath: saved.filePath };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      if (win) win.destroy();
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // 忽略
      }
    }
  });

  /*
   * 0.5.7：检查 GitHub Release 有没有新版本。
   * 入参：{ force?: boolean }（force 跳过 1 小时缓存）
   * 返回：{ ok: true, current, latest, hasUpdate, notes, assetUrl, assetName, assetSize, publishedAt }
   *       或 { ok: false, error }（网络/解析失败不 throw 到渲染进程）
   */
  ipcMain.handle('update:check', async (_event, options) => {
    const force = Boolean(options && options.force);
    const now = Date.now();
    if (!force && updateCheckCache && now - updateCheckCache.at < UPDATE_CHECK_TTL_MS) {
      return updateCheckCache.payload;
    }

    try {
      const response = await net.fetch(UPDATE_RELEASES_API, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'photo-story',
        },
      });

      if (!response.ok) {
        const hint =
          response.status === 403 || response.status === 429
            ? 'GitHub 接口调用太频繁（每小时 60 次），请过一会儿再试'
            : 'GitHub 返回 HTTP ' + response.status;
        return { ok: false, error: hint };
      }

      const list = await response.json();
      if (!Array.isArray(list) || list.length === 0) {
        return { ok: false, error: 'GitHub 上还没有任何 Release' };
      }

      // 只保留正式版本（跳过 draft / prerelease），再按版本号取最大
      const candidates = list.filter(
        (item) => item && !item.draft && !item.prerelease && parseVersionParts(item.tag_name),
      );
      if (candidates.length === 0) return { ok: false, error: 'Release 里没有读到版本号' };
      const release = candidates.reduce((best, item) =>
        compareVersion(item.tag_name, best.tag_name) > 0 ? item : best,
      );

      const current = app.getVersion();
      const latest = String((release && release.tag_name) || '')
        .replace(/^v/i, '')
        .trim();
      if (!latest) return { ok: false, error: 'Release 里没有读到版本号（tag_name 为空）' };

      const asset = pickSetupAsset(release && release.assets);
      const payload = {
        ok: true,
        current,
        latest,
        hasUpdate: compareVersion(latest, current) > 0,
        notes: typeof release.body === 'string' ? release.body : '',
        assetUrl: asset ? asset.url : null,
        assetName: asset ? asset.name : null,
        assetSize: asset ? asset.size : null,
        publishedAt:
          release && typeof release.published_at === 'string' ? release.published_at : null,
      };

      updateCheckCache = { at: now, payload };
      return payload;
    } catch (error) {
      return {
        ok: false,
        error: '检查更新失败：' + (error instanceof Error ? error.message : String(error)),
      };
    }
  });

  /*
   * 0.5.7：流式下载安装包到 %TEMP%\photo-story-update。
   * 入参：{ url, fileName }
   * 返回：{ ok: true, filePath } 或 { ok: false, error }
   * 下载过程中通过 'update:progress' 事件上报 { received, total }。
   */
  ipcMain.handle('update:download', async (_event, payload) => {
    const url = payload && typeof payload.url === 'string' ? payload.url : '';
    const rawName = payload && typeof payload.fileName === 'string' ? payload.fileName : '';

    if (!isAllowedDownloadUrl(url)) {
      return { ok: false, error: '下载地址不在允许范围内（只允许官方 Release 地址）' };
    }

    const dir = path.join(app.getPath('temp'), 'photo-story-update');
    const filePath = path.join(dir, sanitizeDownloadName(rawName));

    try {
      await fs.promises.mkdir(dir, { recursive: true });
    } catch (error) {
      return {
        ok: false,
        error: '创建下载目录失败：' + (error instanceof Error ? error.message : String(error)),
      };
    }

    const file = fs.createWriteStream(filePath);
    let received = 0;
    let total = 0;
    let lastSentAt = 0;
    let settled = false;

    return await new Promise((resolve) => {
      const settle = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const fail = (message) => {
        if (settled) return;
        settled = true;
        try {
          file.destroy();
        } catch {
          // 忽略
        }
        try {
          fs.unlink(filePath, () => undefined);
        } catch {
          // 忽略
        }
        resolve({ ok: false, error: message });
      };

      const request = net.request({ method: 'GET', url, redirect: 'follow' });
      request.setHeader('User-Agent', 'photo-story');
      request.setHeader('Accept', 'application/octet-stream');

      // 进度最多 5 次/秒，避免刷爆渲染进程
      const report = (force) => {
        const at = Date.now();
        if (!force && at - lastSentAt < 200) return;
        lastSentAt = at;
        sendToRenderer('update:progress', { received, total });
      };

      request.on('response', (response) => {
        const status = Number(response.statusCode) || 0;
        if (status !== 200) {
          response.on('error', () => undefined);
          try {
            response.resume();
          } catch {
            // 忽略
          }
          try {
            request.abort();
          } catch {
            // 忽略
          }
          fail('下载失败：HTTP ' + status);
          return;
        }

        total = Number(response.headers['content-length']) || 0;
        report(true);

        response.on('data', (chunk) => {
          if (settled) return;
          received += chunk.length;
          file.write(chunk);
          report(false);
        });

        response.on('end', () => {
          if (settled) return;
          file.end(() => {
            if (settled) return;
            report(true);
            settle({ ok: true, filePath });
          });
        });

        response.on('error', (error) => {
          fail('下载中断：' + (error instanceof Error ? error.message : String(error)));
        });
      });

      request.on('error', (error) => {
        fail('下载失败：' + (error instanceof Error ? error.message : String(error)));
      });

      file.on('error', (error) => {
        try {
          request.abort();
        } catch {
          // 忽略
        }
        fail('写入安装包失败：' + (error instanceof Error ? error.message : String(error)));
      });

      request.end();
    });
  });

  /*
   * 0.5.7：启动 NSIS 安装包，然后退出应用让安装程序接管。
   * 入参：filePath（update:download 返回的路径）
   * 返回：{ ok: true } 或 { ok: false, error }
   */
  ipcMain.handle('update:install', async (_event, filePath) => {
    const target = typeof filePath === 'string' ? filePath.trim() : '';
    if (!target) return { ok: false, error: '缺少安装包路径' };
    if (!/\.exe$/i.test(target)) return { ok: false, error: '不是有效的安装程序' };
    if (!fs.existsSync(target)) return { ok: false, error: '安装包不存在，请重新下载' };

    try {
      spawn(target, [], { detached: true, stdio: 'ignore' }).unref();
      // 给渲染进程留出显示「安装程序已启动」的时间
      setTimeout(() => app.quit(), 800);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: '启动安装程序失败：' + (error instanceof Error ? error.message : String(error)),
      };
    }
  });
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    registerIpc();
    ensureUninstallShortcut();

    const isDev = process.env.PHOTO_STORY_DEV === '1';

    try {
      if (isDev) {
        createWindow();
        return;
      }
      startServer();
      await waitForServer(40000);
      createWindow();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      dialog.showErrorBox(
        '启动失败',
        detail +
          '\n\n可能原因：3939 端口被占用。请关闭占用该端口的程序后重试。',
      );
      stopServer();
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    stopServer();
  });
}

process.on('uncaughtException', (error) => {
  console.error('[main] uncaught exception', error);
  stopServer();
});

process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection', reason);
});
