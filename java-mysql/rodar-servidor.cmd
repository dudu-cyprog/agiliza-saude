@echo off
REM Sobe o site em http://localhost:8080/agiliza/  (Ctrl+C para parar)
cd /d "%~dp0"
call "%USERPROFILE%\tools\apache-maven-3.9.9\bin\mvn.cmd" jetty:run
pause
