#Requires -Version 5.1
<#
  Generates assets\mission-control.ico (multi-resolution) used by the desktop
  shortcut. Pure GDI+; no external tools. Re-run after tweaking the design.

  Design: a satellite orbiting a planet on a deep-space rounded tile, in the
  project's cyan/green accent palette.
#>
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$Root    = Split-Path -Parent $PSScriptRoot
$OutDir  = Join-Path $Root 'assets'
$OutFile = Join-Path $OutDir 'mission-control.ico'
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

function New-RoundedPath {
    param([System.Drawing.RectangleF]$Rect, [single]$Radius)
    $d = $Radius * 2
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($Rect.X, $Rect.Y, $d, $d, 180, 90)
    $p.AddArc($Rect.Right - $d, $Rect.Y, $d, $d, 270, 90)
    $p.AddArc($Rect.Right - $d, $Rect.Bottom - $d, $d, $d, 0, 90)
    $p.AddArc($Rect.X, $Rect.Bottom - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function Draw-Icon {
    param([int]$S)
    $bmp = New-Object System.Drawing.Bitmap($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    $cx = $S / 2.0; $cy = $S / 2.0

    # --- Deep-space rounded tile (vertical gradient) ---
    $pad  = [single]($S * 0.045)
    $rect = New-Object System.Drawing.RectangleF($pad, $pad, ($S - 2 * $pad), ($S - 2 * $pad))
    $tile = New-RoundedPath -Rect $rect -Radius ([single]($S * 0.22))
    $cTop = [System.Drawing.Color]::FromArgb(255, 16, 30, 56)
    $cBot = [System.Drawing.Color]::FromArgb(255, 6, 10, 20)
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $cTop, $cBot, 90)
    $g.FillPath($bg, $tile)
    $bg.Dispose()

    # --- Orbit ring (tilted) ---
    $g.TranslateTransform($cx, $cy)
    $g.RotateTransform(-28)
    $g.TranslateTransform(-$cx, -$cy)
    $ow = [single]($S * 0.66); $oh = [single]($S * 0.30)
    $orbitPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(150, 56, 189, 248), [single]($S * 0.035))
    $g.DrawEllipse($orbitPen, ($cx - $ow / 2), ($cy - $oh / 2), $ow, $oh)
    $orbitPen.Dispose()
    # Satellite sitting on the ring (right vertex of the ellipse, pre-rotation)
    $satR = [single]($S * 0.055)
    $satX = $cx + $ow / 2; $satY = $cy
    $glow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 226, 250, 255))
    $g.FillEllipse($glow, ($satX - $satR * 2), ($satY - $satR * 2), ($satR * 4), ($satR * 4))
    $white = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 240, 252, 255))
    $g.FillEllipse($white, ($satX - $satR), ($satY - $satR), ($satR * 2), ($satR * 2))
    $glow.Dispose(); $white.Dispose()
    $g.ResetTransform()

    # --- Planet (cyan -> green diagonal gradient) ---
    $pr = [single]($S * 0.165)
    $prect = New-Object System.Drawing.RectangleF(($cx - $pr), ($cy - $pr), ($pr * 2), ($pr * 2))
    $cA = [System.Drawing.Color]::FromArgb(255, 34, 211, 238)   # cyan
    $cB = [System.Drawing.Color]::FromArgb(255, 52, 211, 153)   # green
    $pg = New-Object System.Drawing.Drawing2D.LinearGradientBrush($prect, $cA, $cB, 45)
    $g.FillEllipse($pg, $prect)
    $pg.Dispose()
    # Subtle top-left highlight
    $hl = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(70, 255, 255, 255))
    $hr = $pr * 0.55
    $g.FillEllipse($hl, ($cx - $pr * 0.55), ($cy - $pr * 0.6), $hr, $hr)
    $hl.Dispose()

    $g.Dispose()
    return $bmp
}

# Render every size and capture PNG bytes.
$sizes = @(256, 128, 64, 48, 32, 16)
$pngs = @()
foreach ($s in $sizes) {
    $bmp = Draw-Icon -S $s
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngs += , @{ Size = $s; Bytes = $ms.ToArray() }
    $ms.Dispose(); $bmp.Dispose()
}

# Assemble the .ico (PNG-compressed entries; Vista+).
$out = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($out)
$bw.Write([uint16]0)              # reserved
$bw.Write([uint16]1)              # type = icon
$bw.Write([uint16]$pngs.Count)    # image count

$headerSize = 6
$entrySize  = 16
$offset = $headerSize + ($entrySize * $pngs.Count)
foreach ($img in $pngs) {
    $dim = if ($img.Size -ge 256) { 0 } else { $img.Size }
    $bw.Write([byte]$dim)         # width  (0 => 256)
    $bw.Write([byte]$dim)         # height (0 => 256)
    $bw.Write([byte]0)            # palette count
    $bw.Write([byte]0)            # reserved
    $bw.Write([uint16]1)          # color planes
    $bw.Write([uint16]32)         # bits per pixel
    $bw.Write([uint32]$img.Bytes.Length)
    $bw.Write([uint32]$offset)
    $offset += $img.Bytes.Length
}
foreach ($img in $pngs) { $bw.Write($img.Bytes) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($OutFile, $out.ToArray())
$bw.Dispose(); $out.Dispose()

Write-Host "Wrote $OutFile ($((Get-Item $OutFile).Length) bytes, sizes: $($sizes -join ', '))"
