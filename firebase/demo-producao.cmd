@echo off
REM =====================================================================
REM Cria ou apaga PERFIS DE DEMONSTRACAO no site publicado (Firebase real).
REM Precisa da chave da conta de servico:
REM   Console Firebase > engrenagem > Configuracoes do projeto > Contas de servico
REM   > Gerar nova chave privada  (salve FORA desta pasta e apague depois de usar)
REM Dica: arraste o arquivo .json da chave em cima deste atalho.
REM =====================================================================
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=%USERPROFILE%\tools\node-v22.23.4-win-x64;%PATH%"

set "CHAVE=%~1"
if "%CHAVE%"=="" set /p "CHAVE=Caminho do arquivo .json da chave (pode arrastar o arquivo aqui): "
set "CHAVE=%CHAVE:"=%"
if not exist "%CHAVE%" (
  echo Arquivo nao encontrado: %CHAVE%
  pause
  exit /b 1
)
set "GOOGLE_APPLICATION_CREDENTIALS=%CHAVE%"

echo.
echo  1 - Criar 10 perfis de demonstracao
echo  2 - Criar 30 perfis de demonstracao
echo  3 - Apagar TODOS os perfis de demonstracao
echo.
set /p "OPCAO=Escolha (1, 2 ou 3): "
if "%OPCAO%"=="1" node scripts\demo-producao.js criar 10
if "%OPCAO%"=="2" node scripts\demo-producao.js criar 30
if "%OPCAO%"=="3" node scripts\demo-producao.js apagar
echo.
echo Lembre-se de APAGAR o arquivo da chave quando terminar (ela da acesso total ao projeto).
pause
