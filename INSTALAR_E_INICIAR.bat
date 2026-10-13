@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Book Poda - Instalar e iniciar localhost
color 0A
echo =====================================================
echo         BOOK PODA - V12 LOCALHOST
 echo =====================================================
echo.
set "PYEXE="
set "PYOPT="
where py >nul 2>nul
if %errorlevel%==0 (
    py -3 -c "import sys;exit(0 if sys.version_info>=(3,10) else 1)" >nul 2>nul
    if not errorlevel 1 (
        set "PYEXE=py"
        set "PYOPT=-3"
    )
)
if not defined PYEXE (
    where python >nul 2>nul
    if not errorlevel 1 (
        python -c "import sys;exit(0 if sys.version_info>=(3,10) else 1)" >nul 2>nul
        if not errorlevel 1 set "PYEXE=python"
    )
)
if not defined PYEXE (
    echo Python 3.10+ nao encontrado. Tentando instalar com winget...
    where winget >nul 2>nul
    if errorlevel 1 (
        echo ERRO: winget nao encontrado. Instale Python em https://www.python.org/downloads/
        pause
        exit /b 1
    )
    winget install -e --id Python.Python.3.13 --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo A instalacao automatica do Python falhou.
        pause
        exit /b 1
    )
    set "PYEXE=%LocalAppData%\Programs\Python\Python313\python.exe"
    if not exist "%LocalAppData%\Programs\Python\Python313\python.exe" (
        echo Reinicie o terminal e execute novamente este arquivo.
        pause
        exit /b 1
    )
)
echo.
echo [1/3] Preparando o ambiente Python isolado...
if not exist ".venv\Scripts\python.exe" (
    "%PYEXE%" %PYOPT% -m venv ".venv"
    if errorlevel 1 (
        echo Nao foi possivel criar o ambiente Python.
        pause
        exit /b 1
    )
)
echo.
echo [2/3] Verificando/instalando os componentes...
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo Nao foi possivel instalar as dependencias. Verifique a internet.
    pause
    exit /b 1
)
echo.
echo [3/3] Iniciando o servidor em http://localhost:8765/
echo O navegador sera aberto automaticamente.
echo Mantenha esta janela aberta enquanto usar o Book Poda.
echo Para encerrar pressione Ctrl+C.
echo.
".venv\Scripts\python.exe" server.py
if errorlevel 1 (
    echo.
    echo O servidor terminou com um erro.
    pause
)
endlocal
