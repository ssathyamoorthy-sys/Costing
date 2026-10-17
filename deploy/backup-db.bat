@echo off
REM Nightly database backup. Run manually to test, or schedule via Windows Task
REM Scheduler - see deploy/README.md "Automated backups" for one-time setup.
REM Safe to run while the app is live (uses SQLite's VACUUM INTO, not a raw file copy).

setlocal
for %%I in ("%~dp0..") do set "APP_DIR=%%~fI"

cd /d "%APP_DIR%\backend"
if errorlevel 1 (
    echo ERROR: Could not get into %APP_DIR%\backend
    exit /b 1
)

node scripts\backup-db.js
exit /b %errorlevel%
