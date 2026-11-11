# Gera o APK do Concorde para Android (não vai para a Play Store: é só para passar para a galera).
#   powershell -ExecutionPolicy Bypass -File src\ConcordeAndroid\construir-apk.ps1
# Na primeira vez baixa as ferramentas (~500 MB) para %LOCALAPPDATA%\ConcordeAndroid\ferramentas:
# JDK 21 da Microsoft, Gradle e o SDK do Android. O SDK mostra a licença do Google: leia e responda "y" para aceitar.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # a barra de progresso deixa o download do PowerShell muito lento
$T = "$env:LOCALAPPDATA\ConcordeAndroid\ferramentas"
$raiz = Resolve-Path "$PSScriptRoot\..\.."
New-Item -ItemType Directory -Force $T | Out-Null

function Baixar($nome, $url, $pasta) {
    if ((Test-Path $pasta) -and (Get-ChildItem $pasta -ErrorAction SilentlyContinue)) { return }
    Write-Host "== Baixando $nome ==" -ForegroundColor Yellow
    $zip = "$T\$nome.zip"
    Invoke-WebRequest $url -OutFile $zip -UseBasicParsing
    New-Item -ItemType Directory -Force $pasta | Out-Null
    Expand-Archive $zip $pasta -Force
    Remove-Item $zip
}

Baixar 'jdk' 'https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip' "$T\jdk"
Baixar 'gradle' 'https://services.gradle.org/distributions/gradle-8.14.3-bin.zip' "$T\gradle"
# Ferramentas 19.0 de propósito: as mais novas trocaram o sdkmanager pelo "Android CLI", que não instala estes pacotes.
if (-not (Test-Path "$T\sdk\cmdline-tools\19.0\bin\sdkmanager.bat")) {
    Baixar 'cmdline-tools' 'https://dl.google.com/android/repository/commandlinetools-win-13114758_latest.zip' "$T\sdk\tmp"
    # O zip traz a pasta cmdline-tools; o sdkmanager precisa ficar em sdk\cmdline-tools\<versão>
    New-Item -ItemType Directory -Force "$T\sdk\cmdline-tools" | Out-Null
    Move-Item "$T\sdk\tmp\cmdline-tools" "$T\sdk\cmdline-tools\19.0" -Force
    Remove-Item "$T\sdk\tmp" -Recurse -Force
}

$env:JAVA_HOME = (Get-ChildItem "$T\jdk" -Directory | Select-Object -First 1).FullName
$env:ANDROID_HOME = "$T\sdk"
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
$sdk = "$T\sdk\cmdline-tools\19.0\bin\sdkmanager.bat"
$gradle = Join-Path (Get-ChildItem "$T\gradle" -Directory | Select-Object -First 1).FullName 'bin\gradle.bat'

if (-not (Test-Path "$T\sdk\platforms\android-35")) {
    Write-Host "== Licenças do SDK do Android (leia cada uma e responda y) ==" -ForegroundColor Yellow
    & $sdk --sdk_root="$T\sdk" --licenses
    # Os pacotes vão por arquivo: o ";" do nome quebra o argumento quando o PowerShell chama um .bat
    $lista = "$T\pacotes.txt"
    Set-Content $lista "platforms;android-35`r`nbuild-tools;35.0.0`r`nplatform-tools" -Encoding ascii
    & $sdk --sdk_root="$T\sdk" --package_file="$lista"
    if (-not (Test-Path "$T\sdk\platforms\android-35")) { throw "o SDK do Android não instalou (a licença foi aceita?)" }
}

# Chave fixa do Concorde: o Android só aceita atualizar o app com a MESMA chave. Criada uma vez, fica fora do git.
# FAÇA BACKUP de %LOCALAPPDATA%\ConcordeAndroid\concorde.keystore e assinatura.properties: sem eles, a próxima
# versão não atualiza por cima (a galera teria de desinstalar e instalar de novo).
$chave = "$env:LOCALAPPDATA\ConcordeAndroid\concorde.keystore"
$props = "$env:LOCALAPPDATA\ConcordeAndroid\assinatura.properties"
if (-not (Test-Path $props)) {
    Write-Host "== Criando a chave de assinatura do Concorde (só desta vez) ==" -ForegroundColor Yellow
    $senha = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
    & "$env:JAVA_HOME\bin\keytool.exe" -genkeypair -keystore $chave -alias concorde -keyalg RSA -keysize 2048 -validity 36500 `
        -storepass $senha -keypass $senha -dname "CN=Concorde"
    if ($LASTEXITCODE -ne 0) { throw "não deu para criar a chave" }
    Set-Content $props "arquivo=$($chave.Replace('\', '/'))`r`nsenha=$senha" -Encoding ascii
    Write-Host "Chave criada em $chave — guarde uma cópia dela e do assinatura.properties!" -ForegroundColor Yellow
}

# Avisos com o app fechado (Firebase): o google-services.json fica fora do git, em %LOCALAPPDATA%\ConcordeAndroid
# (tutorial em docs\notificacoes-celular.md). Sem ele o APK sai igual, só sem esses avisos.
$firebase = "$env:LOCALAPPDATA\ConcordeAndroid\google-services.json"
if (Test-Path $firebase) { Copy-Item $firebase "$PSScriptRoot\app\google-services.json" -Force; Write-Host "Firebase: ligado (avisos com o app fechado)" -ForegroundColor Green }
else { Remove-Item "$PSScriptRoot\app\google-services.json" -ErrorAction SilentlyContinue; Write-Host "Firebase: sem google-services.json — o APK sai sem os avisos com o app fechado" -ForegroundColor Yellow }

Push-Location $PSScriptRoot
try {
    & $gradle assembleRelease --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "o Gradle falhou" }
} finally { Pop-Location }

$versao = ([regex]::Match((Get-Content "$PSScriptRoot\app\build.gradle" -Raw), "versionName '([^']+)'")).Groups[1].Value
New-Item -ItemType Directory -Force "$raiz\dist" | Out-Null
$apk = "$raiz\dist\Concorde-$versao.apk"
Copy-Item "$PSScriptRoot\app\build\outputs\apk\release\app-release.apk" $apk -Force

# Atualização do app no celular: o Cloudflare só serve arquivos até 25 MB, então o APK vai em partes de 20 MB para
# src\App\public\concorde-android (o site publica junto), com tamanho e SHA-256 para o app conferir.
$pub = "$raiz\src\App\public\concorde-android"
if (Test-Path $pub) { Remove-Item -Recurse -Force $pub }
New-Item -ItemType Directory $pub | Out-Null
$bytes = [IO.File]::ReadAllBytes($apk)
$tamParte = 20MB; $partes = @()
for ($i = 0; $i * $tamParte -lt $bytes.Length; $i++) {
    $nome = "Concorde-$versao.apk.parte$($i + 1)"
    $fim = [Math]::Min(($i + 1) * $tamParte, $bytes.Length) - 1
    [IO.File]::WriteAllBytes("$pub\$nome", $bytes[($i * $tamParte)..$fim])
    $partes += "/concorde-android/$nome"
}
$manifesto = [ordered]@{ versao = $versao; partes = $partes; sha256 = (Get-FileHash $apk -Algorithm SHA256).Hash; tamanho = $bytes.Length }
[IO.File]::WriteAllText("$pub\android.json", ($manifesto | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
Write-Host "APK pronto: $apk (atualização em $($partes.Count) partes)" -ForegroundColor Green
