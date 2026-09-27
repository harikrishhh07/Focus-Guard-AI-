@echo off
title FocusGuard AI Launcher
echo ====================================================================
echo   FocusGuard AI -- Starting Web App and AI Vision Attention Tracker

echo ====================================================================
cd /d "%~dp0"
call .\venv\Scripts\activate.bat
start "FocusGuard Web App" cmd /k "python manage.py runserver"
timeout /t 3 /nobreak >nul
start http://localhost:8000/
echo.
echo FocusGuard AI is up and running at http://localhost:8000/
echo The AI Vision Agent automatically starts with the server.
echo ====================================================================
