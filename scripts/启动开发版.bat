@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

echo ============================================
echo   照片故事 - 开发版启动
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js
  echo.
  echo 请先安装 Node.js 20 或更高版本：https://nodejs.org/zh-cn
  echo 安装时保持默认选项，装完重启这个窗口。
  start "" "https://nodejs.org/zh-cn"
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 首次运行，正在安装依赖，大约需要 2-5 分钟...
  call npm install
  if errorlevel 1 (
    echo.
    echo [错误] 依赖安装失败，请检查网络后重试
    pause
    exit /b 1
  )
)

echo 正在启动服务器，8 秒后自动打开浏览器...
start "" /min cmd /c "timeout /t 8 /nobreak >nul && start "" http://127.0.0.1:3939"

call npm run dev

echo.
echo 服务器已停止。
pause
