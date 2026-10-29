# ============================================================
# 生成应用图标（印章风格）
#
# 印章青蓝底 + 纸色「研」字 + 内框，与界面皮肤同源：
#   accent #537D96 / paper #FBF7EE
# 大尺寸带内框，48px 以下省略内框以免在任务栏糊成一团。
#
# 用法：powershell -ExecutionPolicy Bypass -File scripts\make-icon.ps1
# 产出：build\icon.ico（含 16/24/32/48/64/128/256）
# ============================================================

param([string]$Out = (Join-Path $PSScriptRoot '..\build\icon.ico'))

Add-Type -AssemblyName System.Drawing

$accent = [System.Drawing.Color]::FromArgb(255, 83, 125, 150)   # 印章青蓝
$paper  = [System.Drawing.Color]::FromArgb(255, 251, 247, 238)  # 纸色
$glyph  = [string][char]0x7814                                   # 研

function New-RoundedPath {
    param([single]$x, [single]$y, [single]$w, [single]$h, [single]$r)
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $p.AddArc($x, $y, $d, $d, 180, 90)
    $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure()
    return $p
}

function New-SealBitmap {
    param([int]$Size)

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.Clear([System.Drawing.Color]::Transparent)

    $radius = [single]([Math]::Max(2, $Size * 0.13))
    $seal = New-RoundedPath 0 0 $Size $Size $radius
    $brush = New-Object System.Drawing.SolidBrush($accent)
    $g.FillPath($brush, $seal)
    $brush.Dispose()
    $seal.Dispose()

    # 内框只在大尺寸出现：小图标需要留白给笔画
    if ($Size -ge 48) {
        $inset = [single]($Size * 0.10)
        $innerRadius = [single]([Math]::Max(1, $Size * 0.07))
        $inner = New-RoundedPath $inset $inset ($Size - 2 * $inset) ($Size - 2 * $inset) $innerRadius
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(110, 251, 247, 238), [single]([Math]::Max(1, $Size * 0.012)))
        $g.DrawPath($pen, $inner)
        $pen.Dispose()
        $inner.Dispose()
    }

    # 字号按尺寸线性给足，避免 16px 下缩成一团墨
    $style = if ($Size -le 32) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $emSize = [single]($Size * 0.64)

    # 用字形轮廓取真实包围盒再居中：DrawString / MeasureString 在 PowerShell
    # 下重载解析不可靠，容易把偏移量算成 0 导致字被裁到角落。
    $family = $null
    foreach ($name in @('SimSun', 'Noto Serif SC', 'Microsoft YaHei', 'Segoe UI')) {
        try { $family = New-Object System.Drawing.FontFamily($name); break } catch { }
    }
    if ($null -eq $family) { throw 'no usable font family found' }

    $glyphPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    $origin = New-Object System.Drawing.PointF(0, 0)
    $glyphPath.AddString($glyph, $family, [int]$style, $emSize, $origin, [System.Drawing.StringFormat]::GenericTypographic)
    $bounds = $glyphPath.GetBounds()
    $dx = [single](($Size - $bounds.Width) / 2 - $bounds.X)
    $dy = [single](($Size - $bounds.Height) / 2 - $bounds.Y)
    $matrix = New-Object System.Drawing.Drawing2D.Matrix
    $matrix.Translate($dx, $dy)
    $glyphPath.Transform($matrix)

    $textBrush = New-Object System.Drawing.SolidBrush($paper)
    $g.FillPath($textBrush, $glyphPath)

    $textBrush.Dispose()
    $matrix.Dispose()
    $glyphPath.Dispose()
    $family.Dispose()
    $g.Dispose()
    return $bmp
}

$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = New-Object System.Collections.ArrayList

foreach ($s in $sizes) {
    $bitmap = New-SealBitmap -Size $s
    $stream = New-Object System.IO.MemoryStream
    $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
    [void]$pngs.Add($stream.ToArray())
    $stream.Dispose()
    # 留一张 256 预览，方便打包前目视核对
    if ($s -eq 256) {
        $preview = Join-Path ([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($Out))) 'icon-preview.png'
        $bitmap.Save($preview, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    $bitmap.Dispose()
}

$outPath = [System.IO.Path]::GetFullPath($Out)
$dir = [System.IO.Path]::GetDirectoryName($outPath)
if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

$fs = [System.IO.File]::Create($outPath)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICONDIR
$bw.Write([UInt16]0)
$bw.Write([UInt16]1)
$bw.Write([UInt16]$sizes.Count)

$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $bw.Write([Byte]$dim)
    $bw.Write([Byte]$dim)
    $bw.Write([Byte]0)
    $bw.Write([Byte]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]32)
    $bw.Write([UInt32]$pngs[$i].Length)
    $bw.Write([UInt32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($png in $pngs) { $bw.Write($png) }

$bw.Flush()
$bw.Dispose()
$fs.Dispose()

Write-Output ("icon written: {0} ({1} bytes, sizes {2})" -f $outPath, (Get-Item -LiteralPath $outPath).Length, ($sizes -join '/'))
