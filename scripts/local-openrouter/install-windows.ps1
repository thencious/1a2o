param([switch]$EnableStartup, [switch]$ValidateOnly)

$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$taskDesktop = Join-Path $taskRoot '.context/desktop'
New-Item -ItemType Directory -Path $taskDesktop -Force | Out-Null
$taskPython = Join-Path $env:LOCALAPPDATA 'Programs/Python/Python313/pythonw.exe'
if (!(Test-Path -LiteralPath $taskPython)) { $taskPython = (Get-Command pythonw.exe -ErrorAction Stop).Source }

$taskBrowserCandidates = @(
    (Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google/Chrome/Application/chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google/Chrome/Application/chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft/Edge/Application/msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft/Edge/Application/msedge.exe')
)
$taskBrowser = $taskBrowserCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$taskBrowser) { throw 'Install Chrome or Microsoft Edge before installing the launcher.' }

$taskSuffix = if ($ValidateOnly) { '.validation' } else { '' }
$taskIcon = Join-Path $taskDesktop "1a2o-ring$taskSuffix.ico"
Add-Type -AssemblyName System.Drawing
$taskSource = [Drawing.Image]::FromFile((Join-Path $taskRoot 'apps/web/public/icons/icon-192x192.png'))
$taskBitmap = New-Object Drawing.Bitmap($taskSource, 256, 256)
$taskPng = New-Object IO.MemoryStream
try {
    $taskBitmap.Save($taskPng, [Drawing.Imaging.ImageFormat]::Png)
    $taskBytes = $taskPng.ToArray()
    $taskStream = [IO.File]::Create($taskIcon)
    $taskWriter = New-Object IO.BinaryWriter($taskStream)
    try {
        $taskWriter.Write([uint16]0); $taskWriter.Write([uint16]1); $taskWriter.Write([uint16]1)
        $taskWriter.Write([byte]0); $taskWriter.Write([byte]0); $taskWriter.Write([byte]0); $taskWriter.Write([byte]0)
        $taskWriter.Write([uint16]1); $taskWriter.Write([uint16]32)
        $taskWriter.Write([uint32]$taskBytes.Length); $taskWriter.Write([uint32]22)
        $taskWriter.Write($taskBytes)
    } finally { $taskWriter.Dispose(); $taskStream.Dispose() }
} finally { $taskPng.Dispose(); $taskBitmap.Dispose(); $taskSource.Dispose() }

if ($ValidateOnly) { Write-Output 'Windows launcher interpreter and icon validation passed; configuration and shortcuts were not changed.'; return }

$taskConfigPath = Join-Path $taskDesktop 'launcher.json'
if (!(Test-Path -LiteralPath $taskConfigPath)) {
    $taskConfig = @{
        root = $taskRoot
        browser = $taskBrowser
        arguments = '--app="http://localhost:3000/mail?accountScope=all&split=all"'
        appUserModelId = 'OpenInboxZero.Local'
    } | ConvertTo-Json
    [IO.File]::WriteAllText($taskConfigPath, $taskConfig)
}

& (Join-Path $PSScriptRoot 'register-windows-launcher.ps1') -Root $taskRoot -PythonPath $taskPython -EnableStartup:$EnableStartup
Write-Output '1a2o shortcuts installed. Pin the Start-menu shortcut to the taskbar if desired.'
