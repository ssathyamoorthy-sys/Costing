@echo off
REM Redeploys the Terry Towel Costing app on this server after a code update.
REM Run this from an Administrator Command Prompt.
REM Expects the repo checked out at the path below, and an NSSM service
REM named TerryTowelCosting already created (see deploy/README.md).

setlocal enabledelayedexpansion

set APP_DIR=D:\CostingApp
set SERVICE_NAME=TerryTowelCosting

echo ===================================================
echo  Terry Towel Costing - Redeploy
echo ===================================================

cd /d %APP_DIR%
if errorlevel 1 (
    echo ERROR: Could not find %APP_DIR% - edit APP_DIR at the top of this script.
    pause
    exit /b 1
)

echo.
echo [1/6] Pulling latest code from GitHub...
git pull origin master
if errorlevel 1 (
    echo ERROR: git pull failed - see message above. Nothing else was run.
    pause
    exit /b 1
)

echo.
echo [2/6] Installing backend dependencies...
cd backend
call npm install
if errorlevel 1 goto :error

echo.
echo [3/6] Building backend...
call npm run build
if errorlevel 1 goto :error

echo.
echo [4/6] Applying database migrations (safe to run even if there are none)...
call npx prisma migrate deploy
if errorlevel 1 goto :error

echo.
echo [5/6] Installing and building frontend...
cd ..\frontend
call npm install
if errorlevel 1 goto :error
call npm run build
if errorlevel 1 goto :error

echo.
echo [6/6] Restarting the service...
cd %APP_DIR%
nssm restart %SERVICE_NAME%
if errorlevel 1 (
    echo WARNING: could not restart the service automatically.
    echo Restart it manually with: nssm restart %SERVICE_NAME%
)

echo.
echo ===================================================
echo  Done. The app has been updated and restarted.
echo  Check it loads at http://localhost:4000 on this server.
echo ===================================================
pause
exit /b 0

:error
echo.
echo ===================================================
echo  Redeploy FAILED - see the error above.
echo  The service was NOT restarted, so the previous
echo  working version is still running.
echo ===================================================
pause
exit /b 1
