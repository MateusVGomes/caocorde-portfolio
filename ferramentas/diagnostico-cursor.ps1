# Diagnóstico do cursor sumindo ao transmitir jogos (não mexe em nada do Telinha).
# Use QUANDO o bug estiver acontecendo: rode, volte para o jogo em até 15 s e mexa o mouse até o bipe duplo.
#   powershell -ExecutionPolicy Bypass -File ferramentas\diagnostico-cursor.ps1
# Espera, apita, grava 3 s com 4 métodos de captura e anota o que o Windows diz sobre o cursor.
param([int]$Espera = 15)
$ErrorActionPreference = "Stop"
$out = Join-Path $PSScriptRoot ("cursor-diag-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory $out | Out-Null
$ff = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe | Select-Object -First 1).FullName

Add-Type @"
using System; using System.Runtime.InteropServices;
public static class Cur {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO ci);
  [DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] public static extern bool GetClipCursor(out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
  public static CURSORINFO Ler() { var c = new CURSORINFO(); c.cbSize = Marshal.SizeOf(c); GetCursorInfo(ref c); return c; }
}
"@
[Cur]::SetProcessDPIAware() | Out-Null
$seta = [Cur]::LoadCursor([IntPtr]::Zero, 32512)   # IDC_ARROW (cursor padrão do Windows)

Write-Host "Volte para o jogo em fullscreen e mexa o mouse por cima dele. Começa em $Espera s..."
Start-Sleep $Espera
[console]::beep(880, 250)
$hwnd = [Cur]::GetForegroundWindow()
$hmon = [Cur]::MonitorFromWindow($hwnd, 2).ToInt64()
$pidJogo = 0; [void][Cur]::GetWindowThreadProcessId($hwnd, [ref]$pidJogo)
$nomeJogo = (Get-Process -Id $pidJogo).ProcessName

$metodos = [ordered]@{
  "A-janela-gfxcapture" = @("-f", "lavfi", "-i", "gfxcapture=hwnd=$($hwnd.ToInt64()):capture_cursor=1:max_framerate=30,hwdownload,format=bgra")
  "B-tela-gfxcapture"   = @("-f", "lavfi", "-i", "gfxcapture=hmonitor=$($hmon):capture_cursor=1:max_framerate=30,hwdownload,format=bgra")
  "C-tela-ddagrab"      = @("-f", "lavfi", "-i", "ddagrab=output_idx=0:draw_mouse=1:framerate=30,hwdownload,format=bgra")
  "D-tela-gdigrab"      = @("-f", "gdigrab", "-draw_mouse", "1", "-framerate", "30", "-i", "desktop")
}
$log = @()
$r = New-Object Cur+RECT; [Cur]::GetWindowRect($hwnd, [ref]$r) | Out-Null
$log += "jogo: $nomeJogo | janela: $($r.L),$($r.T) até $($r.R),$($r.B)  ($($r.R-$r.L)x$($r.B-$r.T))"
$clip = New-Object Cur+RECT; [Cur]::GetClipCursor([ref]$clip) | Out-Null
$log += "área do cursor (ClipCursor): $($clip.L),$($clip.T) até $($clip.R),$($clip.B)"

foreach ($k in $metodos.Keys) {
  $args = @("-hide_banner", "-loglevel", "error", "-y") + $metodos[$k] + @("-t", "3", "-vf", "fps=2,scale=960:-2", "$out\$k-%02d.png")
  $p = Start-Process $ff -ArgumentList $args -NoNewWindow -PassThru -RedirectStandardError "$out\$k-erro.txt"
  $amostras = @{}; $sw = [Diagnostics.Stopwatch]::StartNew(); $frente = 0; $n = 0
  while (-not $p.HasExited -and $sw.ElapsedMilliseconds -lt 6000) {
    $c = [Cur]::Ler(); $n++
    $estado = switch ($c.flags) { 0 { "ESCONDIDO" } 1 { "visivel" } 2 { "suprimido" } default { "flags=$($c.flags)" } }
    $tipo = if ($c.hCursor -eq $seta) { "seta-padrao" } elseif ($c.hCursor -eq [IntPtr]::Zero) { "nenhum" } else { "personalizado(0x{0:X})" -f $c.hCursor.ToInt64() }
    $chave = "$estado / $tipo"; $amostras[$chave] = 1 + [int]$amostras[$chave]
    if ([Cur]::GetForegroundWindow() -eq $hwnd) { $frente++ }
    Start-Sleep -Milliseconds 100
  }
  if (-not $p.HasExited) { $p.Kill() }
  $erro = (Get-Content "$out\$k-erro.txt" -Raw -ErrorAction SilentlyContinue)
  $log += "[$k] jogo em primeiro plano em $frente/$n amostras | cursor: " + (($amostras.GetEnumerator() | ForEach-Object { "$($_.Key) x$($_.Value)" }) -join "; ") + $(if ($erro) { " | ERRO: $($erro.Trim())" } else { "" })
}
[console]::beep(660, 200); Start-Sleep -Milliseconds 120; [console]::beep(660, 200)
$log | Set-Content -Encoding utf8 "$out\resultado.txt"
$log
