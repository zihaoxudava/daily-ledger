param(
    [Parameter(Mandatory)][string]$JavaHome,
    [Parameter(Mandatory)][string]$PlatformJar,
    [Parameter(Mandatory)][string]$BuildTools,
    [Parameter(Mandatory)][string]$WorkDir,
    [Parameter(Mandatory)][string]$Keystore,
    [Parameter(Mandatory)][string]$Output,
    [Parameter(Mandatory)][string]$Version,
    [Parameter(Mandatory)][int]$VersionCode
)
$ErrorActionPreference = 'Stop'
if (!$env:LEDGER_SIGNING_PASSWORD) { throw 'Set LEDGER_SIGNING_PASSWORD for the release signing key.' }
$WorkDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($WorkDir)
$env:JAVA_HOME = $JavaHome
$env:Path = (Join-Path $JavaHome 'bin') + [IO.Path]::PathSeparator + $env:Path

function Invoke-Tool {
    param([string]$Program, [string[]]$Arguments)
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Build tool failed: $Program ($LASTEXITCODE)" }
}

$root = Split-Path $PSScriptRoot
$assets = Join-Path $WorkDir 'assets'
$www = Join-Path $assets 'www'
$classes = Join-Path $WorkDir 'classes'
$dex = Join-Path $WorkDir 'dex'
$resources = Join-Path $WorkDir 'res'
New-Item -ItemType Directory -Force $www,$classes,$dex,(Join-Path $resources 'drawable-nodpi') | Out-Null
$siteFiles = 'index.html','app.js','attachments.js','catalog.js','files.js','native.js','note.js',
    'releases.js','schedule.js','store.js','style.css','views.js','manifest.webmanifest',
    'icon-192.png','icon-512.png','apple-touch-icon.png','guide'
foreach ($file in $siteFiles) {
    Copy-Item -LiteralPath (Join-Path $root $file) -Destination $www -Recurse -Force
}
Copy-Item (Join-Path $root 'icon-512.png') (Join-Path $resources 'drawable-nodpi\ledger_icon.png') -Force
Copy-Item (Join-Path $PSScriptRoot 'res\values') -Destination $resources -Recurse -Force

$sources = (Get-ChildItem (Join-Path $PSScriptRoot 'src') -Filter '*.java').FullName
$java = Join-Path $JavaHome 'bin\javac.exe'
Invoke-Tool $java (@('-encoding','UTF-8','-source','8','-target','8','-classpath',$PlatformJar,'-d',$classes) + $sources)
$classFiles = (Get-ChildItem $classes -Recurse -Filter '*.class').FullName
Invoke-Tool (Join-Path $BuildTools 'd8.bat') (@('--min-api','26','--lib',$PlatformJar,'--output',$dex) + $classFiles)

$compiled = Join-Path $WorkDir 'compiled.zip'
$unsigned = Join-Path $WorkDir 'unsigned.apk'
$aligned = Join-Path $WorkDir 'aligned.apk'
Invoke-Tool (Join-Path $BuildTools 'aapt2.exe') @('compile','--dir',$resources,'-o',$compiled)
Invoke-Tool (Join-Path $BuildTools 'aapt2.exe') @('link','-o',$unsigned,'-I',$PlatformJar,
    '--manifest',(Join-Path $PSScriptRoot 'AndroidManifest.xml'),'--min-sdk-version','26','--target-sdk-version','35',
    '--version-name',$Version,'--version-code',"$VersionCode",$compiled)
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$apk = [IO.Compression.ZipFile]::Open($unsigned,[IO.Compression.ZipArchiveMode]::Update)
try {
    foreach ($file in (Get-ChildItem $assets -File -Recurse)) {
        $entry = 'assets/' + $file.FullName.Substring($assets.Length+1).Replace('\','/')
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($apk,$file.FullName,$entry) | Out-Null
    }
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($apk,(Join-Path $dex 'classes.dex'),'classes.dex') | Out-Null
} finally { $apk.Dispose() }
Invoke-Tool (Join-Path $BuildTools 'zipalign.exe') @('-f','-p','4',$unsigned,$aligned)
Invoke-Tool (Join-Path $BuildTools 'apksigner.bat') @('sign','--ks',$Keystore,'--ks-key-alias','daily-ledger',
    '--ks-pass','env:LEDGER_SIGNING_PASSWORD','--key-pass','env:LEDGER_SIGNING_PASSWORD','--v4-signing-enabled','false','--out',$Output,$aligned)
Invoke-Tool (Join-Path $BuildTools 'apksigner.bat') @('verify','--verbose','--print-certs',$Output)
