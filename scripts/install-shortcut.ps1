#Requires -Version 5.1
<#
  Creates a "Mission Control" shortcut on the Windows desktop that runs
  launch.ps1 (one-click start + open browser). Portable: resolves the repo
  from $PSScriptRoot, so it works wherever the repo is cloned.

  Re-run any time to refresh the shortcut (e.g. after moving the repo).
#>
$ErrorActionPreference = 'Stop'

$Root   = Split-Path -Parent $PSScriptRoot
$Launch = Join-Path $Root 'launch.ps1'
$Icon   = Join-Path $Root 'assets\mission-control.ico'
$PsExe  = Join-Path $PSHOME 'powershell.exe'   # Windows PowerShell 5.1

if (-not (Test-Path $Launch)) { throw "No se encontro launch.ps1 en $Root" }

$Desktop = [Environment]::GetFolderPath('Desktop')
$LnkPath = Join-Path $Desktop 'Mission Control.lnk'

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($LnkPath)
$sc.TargetPath       = $PsExe
$sc.Arguments        = "-NoProfile -ExecutionPolicy Bypass -File `"$Launch`""
$sc.WorkingDirectory = $Root
$sc.WindowStyle      = 1   # normal window (live logs visible)
$sc.Description       = 'Mission Control - levanta tu dashboard local de proyectos'
if (Test-Path $Icon) { $sc.IconLocation = "$Icon,0" }
$sc.Save()

Write-Host "Acceso directo creado: $LnkPath"
