@echo off
rem Double-click to open the Lunar Landing Site Navigator locally (always serves the latest files)
cd /d "%~dp0"
start "" http://localhost:8765/
python scripts\serve.py 8765
