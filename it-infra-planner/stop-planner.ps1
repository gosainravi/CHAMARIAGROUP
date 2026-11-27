# Stops the IT Infra Planner web app and API. The database container is stopped too; data is kept.
$root = $PSScriptRoot
foreach ($port in 3000, 8000) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
Push-Location $root
docker compose stop *> $null
Pop-Location
Write-Host "IT Infra Planner stopped. Your projects are kept in the database." -ForegroundColor Cyan
Start-Sleep 2
