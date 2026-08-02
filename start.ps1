Write-Host "Starting Inventory Management System..." -ForegroundColor Green

$backendDir = Join-Path $PSScriptRoot "backend"
$frontendDir = Join-Path $PSScriptRoot "frontend"

# Kill any leftover processes on our ports
Get-Process -Name python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*uvicorn*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*vite*" } | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Starting Backend (FastAPI + SQLite)..." -ForegroundColor Cyan
$backend = Start-Process -NoNewWindow -FilePath "python" -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload" -WorkingDirectory $backendDir -PassThru

Start-Sleep -Seconds 2

Write-Host "Starting Frontend (Vite + React)..." -ForegroundColor Cyan
$frontend = Start-Process -NoNewWindow -FilePath "$env:COMSPEC" -ArgumentList "/c", "npm run dev" -WorkingDirectory $frontendDir -PassThru

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  Backend API:  http://localhost:8000" -ForegroundColor Yellow
Write-Host "  API Docs:     http://localhost:8000/docs" -ForegroundColor Yellow
Write-Host "  Frontend:     http://localhost:5173" -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "Press any key to stop both servers." -ForegroundColor Gray

$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

Stop-Process -Id $backend.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $frontend.Id -Force -ErrorAction SilentlyContinue
Write-Host "Servers stopped." -ForegroundColor Yellow
