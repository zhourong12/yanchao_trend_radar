Add-Type -AssemblyName System.Drawing

$periods = @('05/22-05/28','05/29-06/04','06/05-06/11','06/12-06/18','06/19-06/25','06/26-07/02','07/03-07/09','07/10-07/16')
$series = @{
  package_to_order = @{ label='包裹创建→集运订单'; color='#2563EB'; p50=@(150.5922,133.9656,164.3528,163.9494,125.0161,125.0158,97.9914,53.2350); p90=@(577.7939,516.0772,546.5244,389.7936,362.4614,333.2672,212.0875,116.1825); coverage=@(88.22,87.05,83.83,80.94,77.48,69.99,56.55,25.07) }
  order_to_pay     = @{ label='订单创建→支付';     color='#7C3AED'; p50=@(0.0064,0.0056,0.0069,0.0061,0.0061,0.0061,0.0056,0.0067); p90=@(0.0458,0.0400,0.0339,0.0336,0.0406,0.0439,0.0464,0.0478); coverage=@(100,100,100,100,100,100,100,100) }
  order_to_pack    = @{ label='订单创建→打包完成'; color='#E67E22'; p50=@(17.6444,21.9942,25.5308,24.0272,31.9500,46.7247,30.1661,23.1300); p90=@(38.5892,42.8011,55.9850,61.1644,58.7456,73.1703,65.6419,50.6708); coverage=@(100,100,100,100,100,100,100,89.72) }
  pack_to_out      = @{ label='打包完成→出库';     color='#0F9D76'; p50=@(4.3256,10.0072,14.9922,13.6400,15.9925,13.3489,14.6364,8.2242); p90=@(42.7692,43.9389,46.1956,68.7856,47.9172,36.9747,48.6331,29.8525); coverage=@(100,100,100,99.74,100,100,99.48,94.56) }
}

function New-Color([string]$Hex, [int]$Alpha = 255) {
  $hex = $Hex.TrimStart('#')
  return [Drawing.Color]::FromArgb($Alpha, [Convert]::ToInt32($hex.Substring(0,2),16), [Convert]::ToInt32($hex.Substring(2,2),16), [Convert]::ToInt32($hex.Substring(4,2),16))
}

function Draw-Text($Graphics, [string]$Text, [float]$X, [float]$Y, [float]$Size, [string]$Color='#0F172A', [Drawing.FontStyle]$Style=[Drawing.FontStyle]::Regular) {
  $font = [Drawing.Font]::new('Microsoft YaHei', $Size, $Style, [Drawing.GraphicsUnit]::Pixel)
  $brush = [Drawing.SolidBrush]::new((New-Color $Color))
  $Graphics.DrawString($Text, $font, $brush, $X, $Y)
  $font.Dispose(); $brush.Dispose()
}

function Draw-Panel($Graphics, [float]$Top, [string]$Title, [string]$Field, [float]$MaxY, [bool]$Percent=$false, [bool]$ShowLegend=$false) {
  $left = 120; $right = 1530; $height = 330; $bottom = $Top + $height
  $plotLeft = $left + 25; $plotRight = $right - 30; $plotTop = $Top + 60; $plotBottom = $bottom - 50

  $panelBrush = [Drawing.SolidBrush]::new((New-Color '#FFFFFF'))
  $Graphics.FillRectangle($panelBrush, $left, $Top, $right-$left, $height)
  $panelBrush.Dispose()
  Draw-Text $Graphics $Title ($left+24) ($Top+17) 19 '#0F172A' ([Drawing.FontStyle]::Bold)

  $lastX = $plotLeft + 7 * (($plotRight-$plotLeft)/7)
  $shade = [Drawing.SolidBrush]::new((New-Color '#FEF3C7' 185))
  $Graphics.FillRectangle($shade, $lastX-65, $plotTop, 130, $plotBottom-$plotTop)
  $shade.Dispose()

  $gridPen = [Drawing.Pen]::new((New-Color '#E2E8F0'), 1)
  $axisPen = [Drawing.Pen]::new((New-Color '#CBD5E1'), 1.2)
  for ($i=0; $i -le 4; $i++) {
    $y = $plotBottom - $i * (($plotBottom-$plotTop)/4)
    $Graphics.DrawLine($gridPen, $plotLeft, $y, $plotRight, $y)
    $value = $i * ($MaxY/4)
    $label = if ($Percent) { '{0:0}%' -f $value } else { '{0:0}' -f $value }
    Draw-Text $Graphics $label ($plotLeft-58) ($y-10) 13 '#64748B'
  }
  $Graphics.DrawLine($axisPen, $plotLeft, $plotTop, $plotLeft, $plotBottom)
  $Graphics.DrawLine($axisPen, $plotLeft, $plotBottom, $plotRight, $plotBottom)

  $metricKeys = if ($Field -eq 'coverage') { @('package_to_order','order_to_pack','pack_to_out','order_to_pay') } else { @('package_to_order','order_to_pack','pack_to_out') }
  foreach ($metric in $metricKeys) {
    $item = $series[$metric]
    $pen = [Drawing.Pen]::new((New-Color $item.color), 3.5)
    $pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
    $pointBrush = [Drawing.SolidBrush]::new((New-Color $item.color))
    $points = @()
    for ($i=0; $i -lt 8; $i++) {
      $x = $plotLeft + $i * (($plotRight-$plotLeft)/7)
      $v = [double]$item[$Field][$i]
      $y = $plotBottom - [Math]::Min($v/$MaxY,1) * ($plotBottom-$plotTop)
      $points += [Drawing.PointF]::new($x,$y)
    }
    if ($points.Count -gt 1) { $Graphics.DrawLines($pen, [Drawing.PointF[]]$points) }
    foreach ($p in $points) { $Graphics.FillEllipse($pointBrush, $p.X-5, $p.Y-5, 10, 10) }
    $pen.Dispose(); $pointBrush.Dispose()
  }

  Draw-Text $Graphics '结果未成熟' ($lastX-40) ($plotTop+8) 12 '#92400E' ([Drawing.FontStyle]::Bold)
  if ($ShowLegend) {
    $legendX = $left + 770; $legendY = $Top + 22
    foreach ($metric in $metricKeys) {
      $item = $series[$metric]
      $legendPen = [Drawing.Pen]::new((New-Color $item.color), 4)
      $Graphics.DrawLine($legendPen, $legendX, $legendY+8, $legendX+28, $legendY+8)
      $legendPen.Dispose()
      Draw-Text $Graphics $item.label ($legendX+36) $legendY 13 '#334155'
      $legendX += 205
    }
  }
  $gridPen.Dispose(); $axisPen.Dispose()
}

$bitmap = [Drawing.Bitmap]::new(1650, 1420)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$graphics.Clear((New-Color '#F8FAFC'))

Draw-Text $graphics '集运链路节点耗时：8 个周期波动' 90 42 31 '#0F172A' ([Drawing.FontStyle]::Bold)
Draw-Text $graphics '周期：周五 00:00 至次周五 00:00｜P50 看典型体验，P90 看长尾｜支付节点单独按分钟说明' 92 88 16 '#475569'

Draw-Panel $graphics 135 'P50（中位数）：典型完成耗时（小时）' 'p50' 180 $false $true
Draw-Panel $graphics 490 'P90：最慢 10% 附近的长尾耗时（小时）' 'p90' 640 $false $false
Draw-Panel $graphics 845 '完成覆盖率：判断耗时是否被“只看已完成样本”低估' 'coverage' 100 $true $true

$plotLeft=145; $plotRight=1500
for ($i=0; $i -lt 8; $i++) {
  $x = $plotLeft + $i * (($plotRight-$plotLeft)/7)
  Draw-Text $graphics $periods[$i] ($x-47) 1133 12 '#475569'
}
Draw-Text $graphics '业务周期（2026 年）' 735 1162 14 '#334155'

$calloutBrush = [Drawing.SolidBrush]::new((New-Color '#FFFBEB'))
$calloutPen = [Drawing.Pen]::new((New-Color '#FCD34D'), 1.5)
$graphics.FillRectangle($calloutBrush, 1035, 1075, 445, 82)
$graphics.DrawRectangle($calloutPen, 1035, 1075, 445, 82)
Draw-Text $graphics "包裹→订单覆盖率仅 25.1%`n当前周期结果尚未成熟，耗时会被低估" 1056 1090 14 '#92400E' ([Drawing.FontStyle]::Bold)
$calloutBrush.Dispose(); $calloutPen.Dispose()

$payBrush = [Drawing.SolidBrush]::new((New-Color '#F5F3FF'))
$payPen = [Drawing.Pen]::new((New-Color '#DDD6FE'), 1.5)
$graphics.FillRectangle($payBrush, 110, 1210, 1430, 48)
$graphics.DrawRectangle($payPen, 110, 1210, 1430, 48)
Draw-Text $graphics '支付节点：8 周 P50 约 0.34–0.41 分钟，P90 约 2.0–2.9 分钟，整体稳定。' 135 1222 14 '#5B21B6'
$payBrush.Dispose(); $payPen.Dispose()

Draw-Text $graphics '口径：非测试用户；净订单排除状态 97/98/99。耗时仅统计已到达下一节点且时间非负的记录；覆盖率同步展示分母成熟度。' 92 1290 13 '#64748B'
Draw-Text $graphics '来源：生产业务库只读副本，查询时间 2026-07-17（UTC+8）。07/10–07/16 虽已结束入组，但后续节点仍在持续完成。' 92 1320 13 '#64748B'

$output = Join-Path $PWD 'reports\funnel-node-trend-8cycles-2026-07-17.png'
$bitmap.Save($output, [Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose(); $bitmap.Dispose()
Write-Output $output
