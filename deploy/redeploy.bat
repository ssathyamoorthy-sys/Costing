@echo off
REM Redeploys the Terry Towel Costing app on this server after a code update.
REM Run this from an Administrator Command Prompt, from anywhere - it finds
REM its own location automatically (it must stay inside the repo's "deploy"
REM folder). Expects an NSSM service named TerryTowelCosting already created
REM (see deploy/README.md).

setlocal enabledelayedexpansion

REM This script lives at <repo>\deploy\redeploy.bat - resolve <repo> from
REM its own location so it works no matter where the repo was cloned.
for %%I in ("%~dp0..") do set "APP_DIR=%%~fI"

set SERVICE_NAME=TerryTowelCosting

echo ===================================================
echo  Terry Towel Costing - Redeploy
echo  Repo: %APP_DIR%
echo ===================================================

cd /d "%APP_DIR%"
if errorlevel 1 (
    echo ERROR: Could not get into %APP_DIR%
    pause
    exit /b 1
)

echo.
echo [1/10] Recording current version for rollback...
if not exist deploy mkdir deploy
git rev-parse HEAD > deploy\.previous-commit.txt
if errorlevel 1 (
    echo ERROR: not a git repository - is this really inside the cloned repo?
    pause
    exit /b 1
)
set /p PREV_COMMIT=<deploy\.previous-commit.txt
echo Current version saved as rollback point: %PREV_COMMIT%
echo (run deploy\rollback.bat to return to this exact version if something breaks)

echo.
echo [2/10] Stopping the service (so the rebuild can replace files it has open)...
REM Using "net stop" (built into every Windows install, no PATH dependency on
REM nssm.exe) rather than "nssm stop" - and specifically NOT taskkill, which
REM would bypass NSSM's own stop handling and look like a crash, triggering its
REM automatic restart and immediately re-locking the very files we're about to
REM rebuild.
net stop %SERVICE_NAME%
REM A few seconds for Windows to fully release file handles (the Prisma query engine
REM .dll in particular) after the process exits - without this, a rebuild started
REM immediately can still hit "EPERM: operation not permitted" trying to replace it.
timeout /t 5 /nobreak >nul

echo.
echo [3/10] Pulling latest code from GitHub...
REM npm regenerates package-lock.json slightly on every install (platform-specific
REM optional-dependency resolution), which leaves it locally modified and blocks a
REM clean pull with "local changes would be overwritten." It's just a lockfile -
REM the next npm install step regenerates it anyway - so it's always safe to discard
REM any local drift here before pulling.
git checkout -- backend\package-lock.json frontend\package-lock.json 2>nul
git pull origin master
if errorlevel 1 (
    echo ERROR: git pull failed - see message above.
    goto :error
)

echo.
echo [4/10] Installing backend dependencies...
cd backend
call npm install
if errorlevel 1 goto :error

echo.
echo [5/10] Regenerating Prisma Client from the current schema...
REM npm's allowScripts security gate blocks @prisma/client's postinstall hook (which
REM normally runs this automatically) by default, so the generated TypeScript types
REM silently go stale after a schema change and the build below fails with "property
REM does not exist" errors. Running it explicitly here never depends on that hook.
REM (The service was already stopped in step 2, so the engine .dll it would
REM otherwise overwrite isn't locked - but even then, Windows antivirus can
REM transiently lock a freshly-written .dll while it scans it, so this retries a
REM few times rather than failing on the first EPERM.)
set GENERATE_TRY=0
:generate_retry
call npx prisma generate
if not errorlevel 1 goto :generate_done
set /a GENERATE_TRY+=1
if %GENERATE_TRY% GEQ 5 goto :error
echo Prisma generate failed ^(attempt %GENERATE_TRY%/5, likely a transient file
echo lock - e.g. antivirus scanning the new file^). Retrying in 5 seconds...
timeout /t 5 /nobreak >nul
goto :generate_retry
:generate_done

echo.
echo [6/10] Building backend...
call npm run build
if errorlevel 1 goto :error

echo.
echo [7/10] Backing up the database before migrating...
REM The service is already stopped (step 2), so nothing is writing to prod.db right
REM now - a plain file copy is safe. This is a cheap, local safety net specifically
REM for "the migration about to run breaks something" - it is NOT a substitute for
REM the real nightly backup (see deploy\backup-db.bat), which also protects against
REM disk failure, since both would otherwise live on this same disk.
cd /d "%APP_DIR%"
if exist backend\prod.db (
    if not exist deploy\backups mkdir deploy\backups
    for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set TS=%%T
    copy /y backend\prod.db "deploy\backups\prod-pre-migrate-!TS!.db" >nul
    if errorlevel 1 (
        echo WARNING: could not back up prod.db - continuing anyway, but there will be
        echo no pre-migration snapshot to restore from if this migration goes wrong.
    ) else (
        echo Backup saved: deploy\backups\prod-pre-migrate-!TS!.db
    )
) else (
    echo No backend\prod.db yet - nothing to back up on a fresh install.
)

echo.
echo [8/10] Applying database migrations (safe to run even if there are none -
echo       every migration in this project only ADDS fields, never removes
echo       or changes existing ones, so your existing data is never touched)...
cd backend
call npx prisma migrate deploy
if errorlevel 1 goto :error

echo.
echo [9/10] Installing and building frontend...
cd ..\frontend
call npm install
if errorlevel 1 goto :error
call npm run build
if errorlevel 1 goto :error

echo.
echo [10/10] Starting the service...
cd /d "%APP_DIR%"
net start %SERVICE_NAME%
if errorlevel 1 (
    echo WARNING: could not start the service automatically.
    echo Start it manually with: net start %SERVICE_NAME%
)

echo.
echo ===================================================
echo  Done. The app has been updated and restarted.
echo  Check it loads at http://localhost:4000 on this server.
echo  If anything looks wrong, run deploy\rollback.bat to
echo  go back to the version that was running before this.
echo ===================================================
pause
exit /b 0

:error
echo.
echo ===================================================
echo  Redeploy FAILED - see the error above.
echo  The service was stopped in step 2 (to free up files
echo  for the rebuild) and has NOT been started back up -
echo  the app is offline right now.
echo  Run deploy\rollback.bat to restore the last working
echo  version and bring it back online.
echo ===================================================
pause
exit /b 1
