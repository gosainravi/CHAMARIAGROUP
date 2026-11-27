# Starts IT Infra Planner on this PC: database (Docker), API (port 8000), web app (port 3000), then opens the browser.
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$logs = Join-Path $root "logs"
New-Item -ItemType Directory -Force $logs | Out-Null

function Test-Port($port) {
    try { (New-Object Net.Sockets.TcpClient).Connect("127.0.0.1", $port); return $true } catch { return $false }
}
function Wait-Port($port, $seconds, $what) {
    for ($i = 0; $i -lt $seconds; $i++) { if (Test-Port $port) { return } ; Start-Sleep 1 }
    throw "$what did not start within $seconds s. See $logs"
}

Write-Host "IT Infra Planner - starting..." -ForegroundColor Cyan

# 1. Docker + database
cmd /c "docker info >nul 2>&1"
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Starting Docker Desktop (first start can take a minute)..."
    $dd = @("$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe", "C:\Program Files\Docker\Docker\Docker Desktop.exe") |
        Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $dd) { throw "Docker Desktop is not installed." }
    Start-Process $dd
    for ($i = 0; $i -lt 60; $i++) { cmd /c "docker info >nul 2>&1"; if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 3 }
    if ($LASTEXITCODE -ne 0) { throw "Docker did not start." }
}
Push-Location $root
cmd /c "docker compose up -d > `"$logs\db.log`" 2>&1"
if ($LASTEXITCODE -ne 0) { throw "Database container did not start. See $logs\db.log" }
Pop-Location
Write-Host "  Database running" -ForegroundColor Green

# 2. API
if (-not (Test-Port 8000)) {
    $py = Join-Path $root "backend\.venv\Scripts\python.exe"
    Start-Process -FilePath $py -ArgumentList "-m", "uvicorn", "app.main:app", "--port", "8000" `
        -WorkingDirectory (Join-Path $root "backend") -WindowStyle Hidden `
        -RedirectStandardOutput "$logs\api.log" -RedirectStandardError "$logs\api-error.log"
    Wait-Port 8000 90 "API"
}
Write-Host "  API running on http://localhost:8000" -ForegroundColor Green

# 3. Web app (rebuild only when the source changed since the last build)
$fe = Join-Path $root "frontend"
if (-not (Test-Port 3000)) {
    $build = Join-Path $fe ".next\BUILD_ID"
    $newest = Get-ChildItem $fe -Recurse -File -Include *.ts, *.tsx, *.css, *.json -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch "\\(node_modules|\.next)\\" } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not (Test-Path $build) -or ($newest -and $newest.LastWriteTime -gt (Get-Item $build).LastWriteTime)) {
        Write-Host "  Building the web app (once after updates, ~1 minute)..."
        Push-Location $fe
        cmd /c "npm run build > `"$logs\build.log`" 2>&1"
        if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Web build failed. See $logs\build.log" }
        Pop-Location
    }
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run start -- -p 3000 > `"$logs\web.log`" 2>&1" `
        -WorkingDirectory $fe -WindowStyle Hidden
    Wait-Port 3000 90 "Web app"
}
Write-Host "  Web app running on http://localhost:3000" -ForegroundColor Green

Start-Process "http://localhost:3000"
Write-Host "Ready. Close this window any time; use 'Stop IT Infra Planner' to shut it down." -ForegroundColor Cyan
