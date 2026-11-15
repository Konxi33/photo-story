; build/installer.nsh
; 0.3.6：安装器只做两件事——
;   1) 覆盖安装时清掉旧版中文 exe（0.3.5 及更早），避免两个主程序并存
;   2) 卸载后顺手删掉空目录
; 运行中检测由 electron-builder 自带的 CHECK_APP_RUNNING 处理（会提示关闭软件）；
; 卸载快捷方式由应用启动时补建（见 main.cjs 的 ensureUninstallShortcut）。

!macro customInstall
  Delete "$INSTDIR\照片故事.exe"
!macroend

!macro customUnInstall
  RMDir "$INSTDIR"
!macroend
