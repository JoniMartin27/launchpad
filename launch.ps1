#Requires -Version 5.1
<#
  Mission Control - one-click launcher (Windows)
  --------------------------------------------------
  Starts the dashboard (UI + API + WebSocket) on a single local port and opens
  it in your default browser as soon as it is ready.

  - Portable: locates the project via $PSScriptRoot, so it works wherever the
    repo lives. No hardcoded paths.
  - Idempotent: if the dashboard is already up, it just opens the browser.
  - Foreground: live server logs stay in this window; close the window to stop
    Mission Control (Fastify tree-kills the launched dev servers on exit).

  Create a desktop shortcut to this file (or run scripts\install-shortcut.ps1).
#>
$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$Port = 7777

# Respect a custom dashboard port from config.json (settings.dashboardPort).
$cfgPath = Join-Path $Root 'config.json'
if (Test-Path $cfgPath) {
    try {
        $cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
        if ($cfg.settings -and $cfg.settings.dashboardPort) {
            $Port = [int]$cfg.settings.dashboardPort
        }
    } catch { }
}
$Url = "http://127.0.0.1:$Port"

function Test-PortOpen {
    param([int]$Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if ($iar.AsyncWaitHandle.WaitOne(300) -and $client.Connected) {
            $client.EndConnect($iar)
            return $true
        }
        return $false
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

Write-Host ''
Write-Host '   Mission Control' -ForegroundColor Cyan
Write-Host '   ===============' -ForegroundColor DarkCyan
Write-Host ''

# Already running? Just open the browser and exit.
if (Test-PortOpen -Port $Port) {
    Write-Host "   Ya esta corriendo. Abriendo $Url ..." -ForegroundColor Green
    Start-Process $Url
    Start-Sleep -Seconds 1
    exit 0
}

# Background helper: wait for the port to come up, then open the browser.
$opener = @"
`$ErrorActionPreference = 'SilentlyContinue'
for (`$i = 0; `$i -lt 120; `$i++) {
    try {
        `$c = New-Object System.Net.Sockets.TcpClient
        `$c.Connect('127.0.0.1', $Port)
        if (`$c.Connected) { `$c.Close(); Start-Process '$Url'; break }
    } catch { Start-Sleep -Milliseconds 500 }
}
"@
Start-Process powershell.exe -WindowStyle Hidden `
    -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $opener | Out-Null

Write-Host "   Levantando servidor... el navegador se abrira en $Url" -ForegroundColor Yellow
Write-Host '   (Cierra esta ventana para detener Mission Control)' -ForegroundColor DarkGray
Write-Host ''

Set-Location $Root

# First run: make sure deps are installed and the UI is built, so everything
# is served on the single dashboard port (no separate Vite port to chase).
if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
    Write-Host '   Instalando dependencias (npm install)...' -ForegroundColor DarkYellow
    npm install
}
if (-not (Test-Path (Join-Path $Root 'web\dist\index.html'))) {
    Write-Host '   Construyendo la interfaz (npm run build)...' -ForegroundColor DarkYellow
    npm run build
}

# Foreground: shows live logs; closing the window stops Mission Control.
npm start
$code = $LASTEXITCODE

# Only reached if the server exits on its own (e.g. a startup error) - keep the
# window open so the message is readable instead of flashing closed.
Write-Host ''
Write-Host "   Mission Control se detuvo (codigo $code)." -ForegroundColor DarkGray
Write-Host '   Pulsa una tecla para cerrar...' -ForegroundColor DarkGray
try { $null = [System.Console]::ReadKey($true) } catch { Start-Sleep -Seconds 8 }
