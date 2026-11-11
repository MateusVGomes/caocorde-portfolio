# Gera concorde.ico (logo do 0.5: o gato-controle branco no quadrado laranja) juntando os PNGs de icone\
# que o src\App\branding\renderizar.html gera (node src\App\branding\gerar.mjs).
#   powershell -ExecutionPolicy Bypass -File src\ConcordeDesktop\gerar-icone.ps1
# ICO moderno: cabeçalho + diretório + os PNGs como estão.
$pngs = Get-ChildItem "$PSScriptRoot\icone\icone-*.png" | Sort-Object { [int]($_.BaseName -replace '\D') }
if (-not $pngs) { throw "faltam os PNGs em icone\ (rode o src\App\branding\gerar.mjs e abra renderizar.html)" }
$ms = New-Object IO.MemoryStream
$w = New-Object IO.BinaryWriter $ms
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$pngs.Count)
$offset = 6 + 16 * $pngs.Count
$dados = @()
foreach ($p in $pngs) {
    $bytes = [IO.File]::ReadAllBytes($p.FullName)
    $tam = [int]($p.BaseName -replace '\D')
    $w.Write([byte]($tam % 256)); $w.Write([byte]($tam % 256))  # 256 vira 0
    $w.Write([byte]0); $w.Write([byte]0); $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$bytes.Length); $w.Write([uint32]$offset)
    $offset += $bytes.Length
    $dados += , $bytes
}
foreach ($b in $dados) { $w.Write($b) }
[IO.File]::WriteAllBytes("$PSScriptRoot\concorde.ico", $ms.ToArray())
"concorde.ico: $($pngs.Count) tamanhos, $([math]::Round($ms.Length / 1KB)) KB"
