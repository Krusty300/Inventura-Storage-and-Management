<#
.SYNOPSIS
    Start the Inventura dev environment (Docker Compose).
.PARAMETER Build
    Force rebuild of images.
.PARAMETER Detach
    Run in background (default).
.PARAMETER Logs
    Follow logs after starting.
#>
param(
    [switch]$Build,
    [switch]$Detach = $true,
    [switch]$Logs
)

$ErrorActionPreference = "Stop"
$composeFile = Join-Path $PSScriptRoot "docker-compose.yml"

Write-Host "=== Inventura ===" -ForegroundColor Cyan

if ($Build) {
    Write-Host "Building images..." -ForegroundColor Yellow
    docker compose -f $composeFile build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$detachFlag = if ($Detach) { "--detach" } else { "" }

Write-Host "Starting services..." -ForegroundColor Yellow
docker compose -f $composeFile up $detachFlag
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Services running:" -ForegroundColor Green
Write-Host "  Frontend:  http://localhost"
Write-Host "  Backend:   http://localhost:8000"
Write-Host "  Health:    http://localhost:8000/api/health"
Write-Host ""
Write-Host "Commands:" -ForegroundColor DarkGray
Write-Host "  .\start.ps1 -Build       Rebuild and start"
Write-Host "  .\start.ps1 -Logs        Follow logs"
Write-Host "  docker compose down      Stop all"
Write-Host "  docker compose exec backend python seed.py   Seed data"

if ($Logs) {
    docker compose -f $composeFile logs -f
}
