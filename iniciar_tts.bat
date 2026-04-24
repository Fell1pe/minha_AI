@echo off
title ROBSON - Iniciando...
color 0B

echo.
echo  ==========================================
echo   R.O.B.S.O.N  -  Iniciando Servidores
echo  ==========================================
echo.

cd /d "c:\Users\felli\OneDrive\Desktop\minha_AI"

:: Mata processos antigos nas portas 5500 e 8080
echo  [1/4] Limpando portas antigas...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5500 " ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080 " ^| findstr "LISTENING"') do taskkill /PID %%a /F >nul 2>&1
timeout /t 1 /nobreak >nul

:: Verifica se o Ollama esta rodando
echo  [2/4] Verificando Ollama...
tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | find /I "ollama.exe" >nul
if errorlevel 1 (
    echo       Ollama nao detectado. Iniciando...
    start "" ollama serve
    timeout /t 3 /nobreak >nul
) else (
    echo       Ollama ja esta rodando. OK.
)

:: Inicia servidor TTS (edge-tts) - janela azul
echo  [3/4] Iniciando TTS Server na porta 5500...
start "ROBSON TTS" cmd /k "title ROBSON TTS SERVER && color 09 && cd /d c:\Users\felli\OneDrive\Desktop\minha_AI && python tts_server.py"

:: Aguarda o TTS subir (10 tentativas de 1s)
set tries=0
:wait_tts
timeout /t 1 /nobreak >nul
curl -s --max-time 1 http://localhost:5500/health >nul 2>&1
if %errorlevel% == 0 (
    echo       TTS Server online! OK.
    goto tts_ok
)
set /a tries+=1
if %tries% lss 10 goto wait_tts
echo       AVISO: TTS demorou para subir. Continuando mesmo assim.
:tts_ok

:: Inicia servidor HTTP - janela verde
echo  [4/4] Iniciando HTTP Server na porta 8080...
start "ROBSON HTTP" cmd /k "title ROBSON HTTP SERVER && color 0A && cd /d c:\Users\felli\OneDrive\Desktop\minha_AI && python -m http.server 8080"
timeout /t 2 /nobreak >nul

:: Abre o browser
echo.
echo  Abrindo ROBSON no browser...
start "" "http://localhost:8080"

echo.
echo  ==========================================
echo   ROBSON online em:  http://localhost:8080
echo   TTS rodando em:    http://localhost:5500
echo   Ollama:            http://localhost:11434
echo  ==========================================
echo.
echo  IMPORTANTE: NAO feche as janelas do TTS e HTTP!
echo  Esta janela pode ser fechada.
echo.
pause
