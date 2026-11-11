# Sonda do cursor (só lê, não mexe em nada): o que o Windows diz sobre o cursor com o jogo na frente.
# Rode, volte para o jogo em até 10 s e mexa o mouse até o segundo bipe (10 s). O resultado aparece aqui.
#   powershell -ExecutionPolicy Bypass -File ferramentas\sonda-cursor.ps1
param([int]$Espera = 10, [int]$Segundos = 10)
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class Sonda {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
  [DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO ci);
  [DllImport("user32.dll")] public static extern IntPtr LoadCursor(IntPtr h, int id);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[Sonda]::SetProcessDPIAware() | Out-Null
$seta = [Sonda]::LoadCursor([IntPtr]::Zero, 32512)
Write-Host "Volte para o jogo agora e mexa o mouse (começa em $Espera s)..." -ForegroundColor Yellow
Start-Sleep $Espera
[console]::beep(880, 200)
$amostras = @()
$fim = (Get-Date).AddSeconds($Segundos)
while ((Get-Date) -lt $fim) {
  $ci = New-Object Sonda+CURSORINFO; $ci.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($ci)
  [Sonda]::GetCursorInfo([ref]$ci) | Out-Null
  $pid2 = 0; [Sonda]::GetWindowThreadProcessId([Sonda]::GetForegroundWindow(), [ref]$pid2) | Out-Null
  $amostras += [pscustomobject]@{
    App = (Get-Process -Id $pid2 -ErrorAction SilentlyContinue).ProcessName
    Visivel = [bool]($ci.flags -band 1); Suprimido = [bool]($ci.flags -band 2)
    Cursor = if ($ci.hCursor -eq [IntPtr]::Zero) { 'nenhum' } elseif ($ci.hCursor -eq $seta) { 'seta padrão' } else { 'próprio do app' }
    X = $ci.pt.X; Y = $ci.pt.Y
  }
  Start-Sleep -Milliseconds 250
}
[console]::beep(660, 200); [console]::beep(660, 200)
Write-Host "`nResultado (agrupado):" -ForegroundColor Green
$amostras | Group-Object App, Visivel, Suprimido, Cursor | ForEach-Object {
  $a = $_.Group[0]
  "{0,-20} visível={1,-5} suprimido={2,-5} cursor={3,-15} amostras={4}  (posições de {5},{6} a {7},{8})" -f $a.App, $a.Visivel, $a.Suprimido, $a.Cursor, $_.Count,
    ($_.Group.X | Measure-Object -Minimum).Minimum, ($_.Group.Y | Measure-Object -Minimum).Minimum, ($_.Group.X | Measure-Object -Maximum).Maximum, ($_.Group.Y | Measure-Object -Maximum).Maximum
}
