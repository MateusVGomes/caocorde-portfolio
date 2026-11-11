# Gera dist\ConcordeInstalador.exe (app desktop do Concorde) e prepara a atualização automática.
# Não mexe em nada do Telinha.
#
#   powershell -ExecutionPolicy Bypass -File installer\gerar-concorde.ps1 -Versao 0.2.0
#
# (Sem código de convite dentro: o instalador fica público no site. Quem é novo entra com o código de 6 números do admin.)
# Depois de gerar, publique o site para os apps já instalados receberem a atualização:
#   cd src\App; npx vite build; cd ..\Cloudflare; npx wrangler deploy
param(
    [string]$Versao = "0.1.0",
    [string]$Url = "https://concorde.SEU-SUBDOMINIO.workers.dev/"
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\.."
$staging = Join-Path $root "dist\concorde-staging"
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }

Write-Host "Compilando o Concorde $Versao..."
dotnet publish "$root\src\ConcordeDesktop\Concorde.csproj" -c Release -r win-x64 --self-contained true `
    -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true `
    -p:Version=$Versao -o "$staging" -nologo -v q
if ($LASTEXITCODE) { throw "falha ao compilar" }

$cfg = [ordered]@{ Url = $Url }
[IO.File]::WriteAllText("$staging\concorde.json", ($cfg | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

Write-Host "Juntando o FFmpeg..."
$ffmpeg = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ffmpeg) { throw "ffmpeg.exe não encontrado (winget install Gyan.FFmpeg)" }
Copy-Item $ffmpeg.FullName $staging
Copy-Item (Join-Path $ffmpeg.Directory.Parent.FullName "LICENSE") "$staging\LICENSE-ffmpeg.txt"

Write-Host "Juntando o yt-dlp (bot de música)..."
$ytdlp = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter yt-dlp.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ytdlp) { throw "yt-dlp.exe não encontrado (winget install yt-dlp.yt-dlp)" }
Copy-Item $ytdlp.FullName $staging

Write-Host "Gerando o instalador..."
$iscc = @("$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe", "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "Inno Setup não encontrado (winget install JRSoftware.InnoSetup)" }
& $iscc /Q "/DStaging=$staging" "/DAppVersion=$Versao" "$PSScriptRoot\concorde.iss"
if ($LASTEXITCODE) { throw "falha no Inno Setup" }
Remove-Item -Recurse -Force $staging
$instalador = Get-Item "$root\dist\ConcordeInstalador.exe"

# Atualização automática: o Cloudflare só serve arquivos de até 25 MB, então o instalador vai em partes de 20 MB
# para src\App\public\concorde-app (o site publica junto), com tamanho e SHA-256 para o app conferir.
Write-Host "Preparando a atualização automática..."
$pub = Join-Path $root "src\App\public\concorde-app"
if (Test-Path $pub) { Remove-Item -Recurse -Force $pub }
New-Item -ItemType Directory $pub | Out-Null
$bytes = [IO.File]::ReadAllBytes($instalador.FullName)
$tamParte = 20MB; $partes = @()
for ($i = 0; $i * $tamParte -lt $bytes.Length; $i++) {
    $nome = "ConcordeInstalador-$Versao.parte$($i + 1)"
    $fim = [Math]::Min(($i + 1) * $tamParte, $bytes.Length) - 1
    [IO.File]::WriteAllBytes("$pub\$nome", $bytes[($i * $tamParte)..$fim])
    $partes += "/concorde-app/$nome"
}
$sha = (Get-FileHash $instalador.FullName -Algorithm SHA256).Hash
$manifesto = [ordered]@{ versao = $Versao; partes = $partes; sha256 = $sha; tamanho = $bytes.Length }
[IO.File]::WriteAllText("$pub\versao.json", ($manifesto | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

Write-Host ("Pronto: {0} ({1:N0} MB), atualização em {2} partes" -f $instalador.FullName, ($instalador.Length / 1MB), $partes.Count)
