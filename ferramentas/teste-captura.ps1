# Teste de captura do Concorde: mede quantos quadros por segundo a captura consegue com o JOGO ABERTO,
# por 4 caminhos diferentes, usando o FFmpeg que vem com o Concorde e a placa de vídeo do PC.
# Nada é gravado nem enviado (a saída vai para "lugar nenhum"). No fim mostra uma tabela: tire um print e mande.
# Para rodar: dois cliques no teste-captura.bat (que fica junto deste arquivo).
$ErrorActionPreference = 'Continue'   # o FFmpeg escreve o andamento no stderr: não é erro
$ff = "$env:LOCALAPPDATA\Programs\Concorde\ffmpeg.exe"
if (-not (Test-Path $ff)) { Write-Host "Não achei o Concorde instalado neste PC ($ff)." -ForegroundColor Red; Read-Host 'Enter para sair'; exit 1 }

$placa = (Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Virtual|Parsec|Basic' } | Select-Object -First 1).Name
$encoder = if ($placa -match 'AMD|Radeon') { 'h264_amf -usage ultralowlatency -quality speed -rc cbr -b:v 6000k' }
           elseif ($placa -match 'NVIDIA|GeForce|RTX|GTX') { 'h264_nvenc -preset p1 -tune ll -rc cbr -b:v 6000k' }
           elseif ($placa -match 'Intel') { 'h264_qsv -preset veryfast -b:v 6000k' }
           else { 'h264_mf -hw_encoding 1 -b:v 6000k' }

$cap = 'gfxcapture=monitor_idx=0:max_framerate=60:capture_cursor=1'
$testes = [ordered]@{
    '1080p jeito atual (placa > memória > placa)' = "$cap,fps=60,hwdownload,format=bgra,format=nv12"
    '720p  jeito atual (placa reduz antes)'       = "${cap}:width=1280:height=720:resize_mode=scale_aspect,fps=60,hwdownload,format=bgra,format=nv12"
    '1080p tudo na placa'                         = "$cap,fps=60"
    '720p  tudo na placa'                         = "${cap}:width=1280:height=720:resize_mode=scale_aspect,fps=60"
}

Clear-Host
Write-Host "Teste de captura do Concorde" -ForegroundColor Cyan
Write-Host "Placa: $placa"
Write-Host ""
Write-Host "1. Deixe o jogo aberto na TELA PRINCIPAL, jogando normalmente (de preferência numa partida)." -ForegroundColor Yellow
Write-Host "2. Depois de apertar Enter você tem 15 segundos para voltar para o jogo." -ForegroundColor Yellow
Write-Host "3. O teste dura uns 50 segundos. Continue jogando; quando acabar, volte aqui e tire um print." -ForegroundColor Yellow
Write-Host ""
Read-Host 'Aperte Enter para começar'
for ($i = 15; $i -gt 0; $i--) { Write-Host -NoNewline "`rVolte para o jogo! Começa em $i s...  "; Start-Sleep 1 }
Write-Host ""

$resultados = @()
foreach ($t in $testes.GetEnumerator()) {
    Write-Host "Testando: $($t.Key)..."
    $argumentos = @('-hide_banner', '-loglevel', 'error', '-stats', '-filter_complex', $t.Value, '-t', '10') + ("-c:v $encoder".Split(' ')) + @('-f', 'null', '-')
    $texto = (& $ff @argumentos 2>&1 | ForEach-Object { "$_" }) -join "`n"
    $m = [regex]::Matches($texto, 'frame=\s*(\d+)\s+fps=\s*([\d.]+).*?speed=\s*([\d.]+)x')
    if ($m.Count) {
        $u = $m[$m.Count - 1]
        $resultados += [pscustomobject]@{ Caminho = $t.Key; Quadros = [int]$u.Groups[1].Value; Fps = $u.Groups[2].Value; Velocidade = "$($u.Groups[3].Value)x" }
    } else {
        $erro = ($texto -split "`n" | Where-Object { $_ -match 'rror|fail|Invalid' } | Select-Object -First 1)
        $resultados += [pscustomobject]@{ Caminho = $t.Key; Quadros = 0; Fps = 'FALHOU'; Velocidade = "$erro" }
    }
}

[console]::beep(880, 300)
Write-Host ""
Write-Host "RESULTADO (o ideal é 600 quadros, 60 fps e velocidade 1.0x) — tire um print desta janela:" -ForegroundColor Cyan
Write-Host "Placa: $placa | Encoder: $($encoder.Split(' ')[0])"
$resultados | Format-Table -AutoSize | Out-String | Write-Host
Read-Host 'Enter para fechar'
