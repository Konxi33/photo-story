@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

echo ============================================
echo   照片故事 - 打包成 exe
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js，请先安装：https://nodejs.org/zh-cn
  start "" "https://nodejs.org/zh-cn"
  pause
  exit /b 1
)

echo [1/3] 安装依赖...
call npm install
if errorlevel 1 (
  echo [错误] 依赖安装失败
  pause
  exit /b 1
)

echo.
echo [2/3] 构建并打包，这一步需要几分钟，请不要关闭窗口...
call npm run electron:build
if errorlevel 1 (
  echo.
  echo [错误] 打包失败，请把上面的报错信息截图反馈
  pause
  exit /b 1
)

echo.
echo [3/3] 完成！
echo.
echo exe 已生成，在 dist-electron 文件夹里。
echo 双击「照片故事-x.x.x.exe」即可使用，不需要安装。
explorer dist-electron
pause
