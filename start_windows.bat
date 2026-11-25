@echo off
title OBD2 Studio - Local Server & Wi-Fi Bridge
cd /d "%~dp0"
echo Starting OBD2 Studio on http://127.0.0.1:8080 ...
start "" http://127.0.0.1:8080
python server.py
pause
