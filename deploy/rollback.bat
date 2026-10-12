@echo off
REM Rolls the app back to the version that was running immediately before
REM the last deploy\redeploy.bat run - use this if an update breaks
REM something. Run from an Administrator Command Prompt.
REM
REM This only moves the CODE backward. It deliberately does NOT undo
REM database migrations: every migration in this project only adds new
REM optional fields and never removes or renames existing ones, so the
REM older code version runs fine against the newer database shape - your
REM data (quotes, customers, rates, users, everything) is untouched either
REM way. Never run this expecting data entered after the update to vanish
REM with it - it won't, and it isn't meant to.

setlocal enabledelayedexpansion

for %%I in ("%~dp0..") do set "APP_DIR=%%~fI"

REM If nssm.exe isn't on the system PATH, change this to its full path,
REM e.g. C:\nssm\win64\nssm.exe
set NSSM_PATH=nssm

set SERVICE_NAME=TerryTowelCosting

echo ===================================================
echo  Terry Towel Costing - Rollback
echo  Repo: %APP_DIR%
echo ===================================================

cd /d "%APP_DIR%"

if not exist deploy\.previous-commit.txt (
    echo ERROR: deploy\.previous-commit.txt not found.
    echo This is written automatically by redeploy.bat before each update -
    echo there's nothing to roll back to until redeploy.bat has run at least once.
    pause
    exit /b 1
)
set /p PREV_COMMIT=<deploy\.previous-commit.txt

echo.
echo This will move the code back to:
echo   %PREV_COMMIT%
echo (the version running immediately before the last redeploy)
echo.
set /p CONFIRM=Continue? [y/N]
if /i not "%CONFIRM%"=="y" (
    echo Cancelled - nothing changed.
    pause
    exit /b 0
)

echo.
echo [1/5] Reverting code to the previous version...
git reset --hard %PREV_COMMIT%
if errorlevel 1 goto :error

echo.
echo [2/6] Reinstalling backend dependencies for that version...
cd backend
call npm install
if errorlevel 1 goto :error

echo.
echo [3/6] Regenerating Prisma Client for that version's schema...
REM Needed even going backward - npm's allowScripts gate blocks the postinstall
REM hook that would otherwise do this automatically (see redeploy.bat).
call npx prisma generate
if errorlevel 1 goto :error

echo.
echo [4/6] Rebuilding backend...
call npm run build
if errorlevel 1 goto :error

echo.
echo [5/6] Reinstalling and rebuilding frontend...
cd ..\frontend
call npm install
if errorlevel 1 goto :error
call npm run build
if errorlevel 1 goto :error

echo.
echo [6/6] Restarting the service...
cd /d "%APP_DIR%"
"%NSSM_PATH%" restart %SERVICE_NAME%
if errorlevel 1 (
    echo WARNING: could not restart the service automatically.
    echo Restart it manually with: %NSSM_PATH% restart %SERVICE_NAME%
)

echo.
echo ===================================================
echo  Rolled back to %PREV_COMMIT% and restarted.
echo  Check it loads at http://localhost:4000
echo  Do NOT run redeploy.bat again until the issue with
echo  the newer version has actually been fixed on GitHub -
echo  otherwise it will just pull the same broken version back.
echo ===================================================
pause
exit /b 0

:error
echo.
echo ===================================================
echo  Rollback FAILED partway through - see the error above.
echo  The service was NOT restarted. Do not assume either
echo  version is fully working right now - check manually
echo  before telling anyone the app is back up.
echo ===================================================
pause
exit /b 1
