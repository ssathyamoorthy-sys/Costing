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
echo [1/7] Stopping the service (so the rebuild can replace files it has open)...
REM Using "net stop" (built into every Windows install, no PATH dependency on
REM nssm.exe) rather than "nssm stop" - and specifically NOT taskkill, which
REM would bypass NSSM's own stop handling and look like a crash, triggering its
REM automatic restart and immediately re-locking the very files we're about to
REM rebuild.
net stop %SERVICE_NAME%
REM A few seconds for Windows to fully release file handles (the Prisma query engine
REM .dll in particular) after the process exits.
timeout /t 5 /nobreak >nul

echo.
echo [2/7] Reverting code to the previous version...
git reset --hard %PREV_COMMIT%
if errorlevel 1 goto :error

echo.
echo [3/7] Reinstalling backend dependencies for that version...
cd backend
call npm install
if errorlevel 1 goto :error

echo.
echo [4/7] Regenerating Prisma Client for that version's schema...
REM Needed even going backward - npm's allowScripts gate blocks the postinstall
REM hook that would otherwise do this automatically (see redeploy.bat). Retries
REM a few times in case of a transient file lock (e.g. antivirus scanning the
REM freshly-written .dll) even though the service is already stopped.
set GENERATE_TRY=0
:generate_retry
call npx prisma generate
if not errorlevel 1 goto :generate_done
set /a GENERATE_TRY+=1
if %GENERATE_TRY% GEQ 5 goto :error
echo Prisma generate failed ^(attempt %GENERATE_TRY%/5^). Retrying in 5 seconds...
timeout /t 5 /nobreak >nul
goto :generate_retry
:generate_done

echo.
echo [5/7] Rebuilding backend...
call npm run build
if errorlevel 1 goto :error

echo.
echo [6/7] Reinstalling and rebuilding frontend...
cd ..\frontend
call npm install
if errorlevel 1 goto :error
call npm run build
if errorlevel 1 goto :error

echo.
echo [7/7] Starting the service...
cd /d "%APP_DIR%"
net start %SERVICE_NAME%
if errorlevel 1 (
    echo WARNING: could not start the service automatically.
    echo Start it manually with: net start %SERVICE_NAME%
)

echo.
echo ===================================================
echo  Rolled back to %PREV_COMMIT% and started.
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
echo  The service was stopped in step 1 and has NOT been
echo  started back up - the app is offline right now.
echo  Check the error, fix it if you can, and try
echo  deploy\rollback.bat again - or start the service
echo  manually once you're confident what's on disk works:
echo  net start %SERVICE_NAME%
echo ===================================================
pause
exit /b 1
