# =====================================================================
#  FabriHub · publicar desde el PC con Cloudflare Tunnel
#
#    powershell -ExecutionPolicy Bypass -File scripts\tunnel\publicar.ps1
#
#  Úsalo cada vez que enciendas el PC. Levanta la app, pide un túnel NUEVO
#  (el anterior muere al apagar o suspender), guarda la URL en
#  APP_PUBLIC_URL (enlaces de los correos) y la muestra.
# =====================================================================

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")

$envFile = ".env.production"
$compose = @("compose", "-f", "docker-compose.yml", "-f", "docker-compose.tunnel.yml", "--env-file", $envFile)

if (-not (Test-Path $envFile)) { throw "No existe $envFile" }

Write-Host "[1/4] Levantando FabriHub..."
& docker @compose up -d
if ($LASTEXITCODE -ne 0) { throw "docker compose up falló" }

Write-Host "[2/4] Pidiendo un túnel nuevo a Cloudflare..."
& docker @compose up -d --force-recreate tunnel
if ($LASTEXITCODE -ne 0) { throw "no se pudo recrear el túnel" }

$url = $null
for ($i = 0; $i -lt 30 -and -not $url; $i++) {
    Start-Sleep -Seconds 2
    # cloudflared escribe en stderr; vía cmd para que PowerShell 5.1 no lo trate como error
    $logs = (cmd /c "docker logs fabrihub-tunnel 2>&1") | Out-String
    $m = [regex]::Matches($logs, "https://[a-z0-9-]+\.trycloudflare\.com")
    if ($m.Count -gt 0) { $url = $m[$m.Count - 1].Value }
}
if (-not $url) { throw "Cloudflare no entregó una URL; revisa: docker logs fabrihub-tunnel" }

Write-Host "[3/4] Guardando la URL en $envFile y reiniciando la API..."
# Sin BOM y conservando los saltos de línea LF del archivo
$path = (Resolve-Path $envFile).Path
$text = [IO.File]::ReadAllText($path)
$text = [regex]::Replace($text, "(?m)^APP_PUBLIC_URL=.*$", "APP_PUBLIC_URL=$url")
[IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
& docker @compose up -d api
if ($LASTEXITCODE -ne 0) { throw "no se pudo reiniciar la API" }

Write-Host "[4/4] Esperando a que la URL responda..."
$ok = $false
for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
    Start-Sleep -Seconds 3
    try { $ok = (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 10).StatusCode -eq 200 } catch { }
}

Write-Host ""
if ($ok) { Write-Host "FabriHub publicado en: $url" -ForegroundColor Green }
else { Write-Host "URL asignada: $url (aún no responde; espera un minuto e inténtalo)" -ForegroundColor Yellow }
