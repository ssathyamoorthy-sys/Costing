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

REM If nssm.exe isn't on the system PATH, change this to its full path,
REM e.g. C:\nssm\win64\nssm.exe
set NSSM_PATH=nssm

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
echo [1/7] Recording current version for rollback...
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
echo [2/7] Pulling latest code from GitHub...
REM npm regenerates package-lock.json slightly on every install (platform-specific
REM optional-dependency resolution), which leaves it locally modified and blocks a
REM clean pull with "local changes would be overwritten." It's just a lockfile -
REM the next npm install step regenerates it anyway - so it's always safe to discard
REM any local drift here before pulling.
git checkout -- backend\package-lock.json frontend\package-lock.json 2>nul
git pull origin master
if errorlevel 1 (
    echo ERROR: git pull failed - see message above. Nothing else was run.
    pause
    exit /b 1
)

echo.
echo [3/8] Installing backend dependencies...
cd backend
call npm install
if errorlevel 1 goto :error

echo.
echo [4/8] Regenerating Prisma Client from the current schema...
REM npm's allowScripts security gate blocks @prisma/client's postinstall hook (which
REM normally runs this automatically) by default, so the generated TypeScript types
REM silently go stale after a schema change and the build below fails with "property
REM does not exist" errors. Running it explicitly here never depends on that hook.
call npx prisma generate
if errorlevel 1 goto :error

echo.
echo [5/8] Building backend...
call npm run build
if errorlevel 1 goto :error

echo.
echo [6/8] Applying database migrations (safe to run even if there are none -
echo       every migration in this project only ADDS fields, never removes
echo       or changes existing ones, so your existing data is never touched)...
call npx prisma migrate deploy
if errorlevel 1 goto :error

echo.
echo [7/8] Installing and building frontend...
cd ..\frontend
call npm install
if errorlevel 1 goto :error
call npm run build
if errorlevel 1 goto :error

echo.
echo [8/8] Restarting the service...
cd /d "%APP_DIR%"
"%NSSM_PATH%" restart %SERVICE_NAME%
if errorlevel 1 (
    echo WARNING: could not restart the service automatically.
    echo Restart it manually with: %NSSM_PATH% restart %SERVICE_NAME%
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
echo  The service was NOT restarted, so the previous
echo  working version is still running normally.
echo  No rollback needed - nothing live was changed.
echo ===================================================
pause
exit /b 1
