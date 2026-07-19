Add-Type -AssemblyName System.Drawing

$buildDirectory = Join-Path $PSScriptRoot '..\build'
New-Item -ItemType Directory -Path $buildDirectory -Force | Out-Null

$bitmap = New-Object System.Drawing.Bitmap 256, 256
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::FromArgb(9, 11, 14))

$outerPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(102, 112, 105)), 7
$innerPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(216, 255, 62)), 8
$softPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(95, 216, 255, 62)), 4
$limeBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(216, 255, 62))

$outer = [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point 128, 20),
  (New-Object System.Drawing.Point 236, 128),
  (New-Object System.Drawing.Point 128, 236),
  (New-Object System.Drawing.Point 20, 128)
)
$middle = [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point 128, 58),
  (New-Object System.Drawing.Point 198, 128),
  (New-Object System.Drawing.Point 128, 198),
  (New-Object System.Drawing.Point 58, 128)
)
$inner = [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point 128, 91),
  (New-Object System.Drawing.Point 165, 128),
  (New-Object System.Drawing.Point 128, 165),
  (New-Object System.Drawing.Point 91, 128)
)

$graphics.DrawPolygon($outerPen, $outer)
$graphics.DrawPolygon($softPen, $middle)
$graphics.DrawPolygon($innerPen, $inner)
$graphics.FillRectangle($limeBrush, 119, 119, 18, 18)

$pngPath = Join-Path $buildDirectory 'icon.png'
$icoPath = Join-Path $buildDirectory 'icon.ico'
$bitmap.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)

$iconHandle = $bitmap.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($iconHandle)
$stream = [System.IO.File]::Create($icoPath)
$icon.Save($stream)
$stream.Close()

$icon.Dispose()
$limeBrush.Dispose()
$softPen.Dispose()
$innerPen.Dispose()
$outerPen.Dispose()
$graphics.Dispose()
$bitmap.Dispose()

Write-Host "Created build/icon.png and build/icon.ico"
