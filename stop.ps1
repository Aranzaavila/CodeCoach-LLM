# Detiene el servidor de FastAPI (puerto 8000)
$backend = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
if ($backend) {
    $pid8000 = $backend.OwningProcess
    Stop-Process -Id $pid8000 -Force
    Write-Host "Backend detenido (puerto 8000)" -ForegroundColor Green
} else {
    Write-Host "Backend no estaba corriendo" -ForegroundColor Yellow
}

# Detiene el servidor de Vite (puerto 5173)
$frontend = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
if ($frontend) {
    $pid5173 = $frontend.OwningProcess
    Stop-Process -Id $pid5173 -Force
    Write-Host "Frontend detenido (puerto 5173)" -ForegroundColor Green
} else {
    Write-Host "Frontend no estaba corriendo" -ForegroundColor Yellow
}

Write-Host "`nCodeCoach detenido." -ForegroundColor Cyan