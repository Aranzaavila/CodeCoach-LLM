# Abre el backend en una nueva ventana
Start-Process powershell -ArgumentList "-NoExit", "-Command", ".\venv\Scripts\Activate.ps1; uvicorn api:app --host 0.0.0.0 --port 8000"

# Abre el frontend en otra ventana nueva
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"

# Abre el navegador automáticamente
Start-Sleep -Seconds 3
Start-Process "http://localhost:5173"