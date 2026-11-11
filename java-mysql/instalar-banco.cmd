@echo off
REM Cria o banco agiliza_saude (tabelas, dados de teste, usuario da aplicacao)
REM e carrega os 100 perfis ficticios de demonstracao (sql\dados_demo_100.sql).
REM Vai pedir a senha do root do MySQL.
chcp 65001 >nul
cd /d "%~dp0"
set MYSQL="C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe"
echo Digite a senha do usuario root do MySQL:
(type sql\agiliza_saude.sql & type sql\dados_demo_100.sql) | %MYSQL% -u root -p --default-character-set=utf8mb4
if errorlevel 1 (
  echo.
  echo ERRO ao criar o banco. Confira a senha do root e se o servico MySQL80 esta rodando.
) else (
  echo.
  echo Banco agiliza_saude criado com sucesso, com 102 pacientes de demonstracao!
  echo Lista dos perfis: sql\perfis-fakes.csv
)
pause
