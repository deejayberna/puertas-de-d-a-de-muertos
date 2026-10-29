@echo off
chcp 65001 >nul
title Puertas de Dia de Muertos
cd /d "%~dp0"

REM ===== CAMBIA AQUI LA CONTRASENA DEL PANEL DE ADMINISTRACION =====
set ADMIN_PASSWORD=catrina2026
REM ===== Puerto (normalmente no hay que tocarlo) =====
set PORT=3000

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  No encontre Node.js. Instalalo desde https://nodejs.org ^(version LTS^) y vuelve a abrir este archivo.
  echo.
  pause
  exit /b
)

if not exist "node_modules\express" (
  echo.
  echo  Instalando dependencias por primera vez, espera un momento...
  call npm install --no-audit --no-fund
)
if not exist "node_modules\three\build" call npm install --no-audit --no-fund

start "" http://localhost:%PORT%
node server.js
pause
