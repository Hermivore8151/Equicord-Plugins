@echo off
:: Change to the directory where this batch file is located
cd /d "%~dp0"

echo ==========================================
echo   Equicord Auto-Build and Plugin Sync
echo ==========================================

:: 1. Check for Git
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Git is not installed or not in your PATH, please run `winget install --id Git.Git -e --source winget`
    pause
    exit /b 1
)

:: 2. Check for pnpm
where pnpm >nul 2>nul
if %errorlevel% neq 0 (
    echo [!] pnpm not found. Attempting to install globally via npm...
    call npm i -g pnpm
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install pnpm. Make sure Node.js and npm are installed, If they aren't, please run `winget install -e --id OpenJS.NodeJS`
        pause
        exit /b 1
    )
)

:: 3. Clone or update Equicord
if not exist "Equicord" (
    echo [*] Cloning Equicord repository...
    git clone https://github.com/Equicord/Equicord
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to clone Equicord.
        pause
        exit /b 1
    )
) else (
    echo [*] Equicord folder found. Pulling latest changes...
    pushd Equicord
    git pull
    popd
)

cd Equicord

:: 4. Clean node_modules
echo [*] Cleaning node_modules to ensure a fresh install...
if exist "node_modules" rmdir /s /q node_modules

:: 5. Download plugins from CDN using PowerShell
echo [*] Syncing custom plugins from CDN...
powershell -ExecutionPolicy Bypass -Command "$baseUrl='https://hermivore.cat/cdn/discord/plugins/'; try { $root=Invoke-RestMethod -Uri ($baseUrl+'.contents'); foreach($d in $root.directories){ $p='src/userplugins/'+$d; if(!(Test-Path $p)){New-Item -ItemType Directory -Path $p -Force|Out-Null}; try{ $c=Invoke-RestMethod -Uri ($baseUrl+$d+'/.contents'); foreach($f in $c.files){ if($f -ne 'nothing_here.txt'){ $u=$baseUrl+$d+'/'+$f; Write-Host ('  -> Downloading ' + $f); Invoke-WebRequest -Uri $u -OutFile (Join-Path $p $f) } } }catch{} } }catch{}"

:: 6. Install dependencies
echo [*] Installing dependencies...
call pnpm install --no-frozen-lockfile

:: 7. Build
echo [*] Building Equicord...
call pnpm build --dev -branch stable

:: 8. Inject
echo [*] Injecting into Discord...
call pnpm inject

echo.
echo ==========================================
echo   Build and Inject Complete!
echo ==========================================
pause
