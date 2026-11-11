; Instalador do Concorde (app desktop). Gerado por installer\gerar-concorde.ps1 — não rode o ISCC direto.
; Separado do Telinha: outro AppId, outra pasta, outros atalhos. Instala só para o usuário (sem administrador).

#ifndef Staging
  #error Rode installer\gerar-concorde.ps1
#endif
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{B7C2D9E4-1A3F-4E6B-9C8D-5F2A7E1B3C90}
AppName=Caocorde
AppVersion={#AppVersion}
AppPublisher=Os Sacanas
DefaultDirName={localappdata}\Programs\Concorde
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=ConcordeInstalador
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile=..\src\ConcordeDesktop\concorde.ico
UninstallDisplayIcon={app}\Concorde.exe
UninstallDisplayName=Caocorde
CloseApplications=yes
MinVersion=10.0

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "desktopicon"; Description: "Criar atalho na área de trabalho"; GroupDescription: "Atalhos:"

[Files]
Source: "{#Staging}\Concorde.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Staging}\concorde.json"; DestDir: "{app}"; Flags: ignoreversion
; Captura e codificação da transmissão pela placa de vídeo (mesmo FFmpeg do Telinha).
Source: "{#Staging}\ffmpeg.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#Staging}\LICENSE-ffmpeg.txt"; DestDir: "{app}"; Flags: ignoreversion
; Bot de música: acha e baixa o áudio (YouTube, SoundCloud…).
Source: "{#Staging}\yt-dlp.exe"; DestDir: "{app}"; Flags: ignoreversion

; O app virou "Caocorde" (0.5.10). A pasta e o Concorde.exe continuam com o nome antigo de propósito: o atualizador
; automático de quem já tem o app procura por eles. Só os atalhos mudam de nome — os antigos são apagados.
[InstallDelete]
Type: files; Name: "{userprograms}\Concorde.lnk"
Type: files; Name: "{userdesktop}\Concorde.lnk"

[Icons]
Name: "{userprograms}\Caocorde"; Filename: "{app}\Concorde.exe"
Name: "{userdesktop}\Caocorde"; Filename: "{app}\Concorde.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Concorde.exe"; Description: "Abrir o Caocorde"; Flags: postinstall nowait skipifsilent
; Atualização automática: o app roda o instalador em silêncio com /RELANCAR e ele reabre o Concorde no fim.
Filename: "{app}\Concorde.exe"; Flags: nowait; Check: DeveRelancar

[Code]
// Desinstalar com o Concorde aberto: fecha ele antes. Senão o Windows só apaga o .exe depois de reiniciar e o app
// continua rodando (e transmitindo) sem estar mais instalado. Primeiro pede para fechar (encerra a call e a
// transmissão direitinho); se em 3 s não fechou, força (o FFmpeg e o yt-dlp vão junto, /T).
function InitializeUninstall: Boolean;
var
  Codigo: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM Concorde.exe', '', SW_HIDE, ewWaitUntilTerminated, Codigo);
  if Codigo = 0 then Sleep(3000);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM Concorde.exe', '', SW_HIDE, ewWaitUntilTerminated, Codigo);
  Result := True;
end;

function DeveRelancar: Boolean;
begin
  Result := WizardSilent and (Pos('/RELANCAR', UpperCase(GetCmdTail)) > 0);
end;
