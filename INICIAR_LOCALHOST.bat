@echo off
setlocal
cd /d "%~dp0"
title Book Poda - Localhost
if not exist ".venv\Scripts\python.exe" (
    echo Primeira execucao: use INSTALAR_E_INICIAR.bat
    pause
    exit /b 1
)
".venv\Scripts\python.exe" server.py
if errorlevel 1 pause
endlocal
