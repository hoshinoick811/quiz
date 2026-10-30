@echo off
chcp 65001 >nul
title 运维题库
cd /d "%~dp0"

set "NODE_EXE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE_EXE=C:\Users\anna\.dsh-beta\dsh-runtimes\dsh-plugin-desktop-beta-primary-runtime\dependencies\node\bin\node.exe"

echo.
echo   正在启动题库服务...
echo.
"%NODE_EXE%" server.js

echo.
echo   服务已停止。按任意键关闭窗口。
pause >nul
