param([string]$Root, [string]$PythonPath, [switch]$EnableStartup)
$ErrorActionPreference = 'Stop'
if (!$Root) { $Root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path }
if (!$PythonPath) { $PythonPath = Join-Path $env:LOCALAPPDATA 'Programs/Python/Python313/pythonw.exe' }
$taskPython = Join-Path (Split-Path $PythonPath) 'pythonw.exe'
$taskEntry = Join-Path $Root 'scripts/local-openrouter/launch_app.py'
$taskIcon = Join-Path $Root '.context/desktop/1a2o-ring.ico'
$taskActiveIcon = Join-Path $Root '.context/desktop/active-icon.json'
if (Test-Path -LiteralPath $taskActiveIcon) {
    $taskIconName = (Get-Content -LiteralPath $taskActiveIcon -Raw | ConvertFrom-Json).filename
    if ($taskIconName -notmatch '^1a2o-windows-[a-f0-9]{10}\.ico$') { throw 'Invalid app icon filename' }
    $taskIcon = Join-Path $Root ('.context/desktop/' + $taskIconName)
}
$taskOldLauncher = Join-Path $Root '.context/desktop/Inbox Zero.exe'
foreach ($taskFile in @($taskPython, $taskEntry, $taskIcon)) {
    if (!(Test-Path -LiteralPath $taskFile)) { throw "Required launcher file is missing: $taskFile" }
}
$taskShell = New-Object -ComObject WScript.Shell
$taskDesktop = [Environment]::GetFolderPath('Desktop')
$taskPrograms = [Environment]::GetFolderPath('Programs')
$taskStartup = [Environment]::GetFolderPath('Startup')
$taskPinned = Join-Path $env:APPDATA 'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar'
$taskExisting = @(
    foreach ($taskFolder in @($taskDesktop, $taskPrograms, $taskStartup, $taskPinned)) {
        Get-ChildItem -LiteralPath $taskFolder -Filter '*.lnk' -ErrorAction SilentlyContinue | Where-Object {
            $taskLink = $taskShell.CreateShortcut($_.FullName)
            $taskLink.TargetPath -eq $taskOldLauncher -or ($taskLink.TargetPath -eq $taskPython -and $taskLink.Arguments.Contains($taskEntry))
        }
    }
)
$taskTemplate = $taskExisting | Where-Object { $_.DirectoryName -eq $taskPinned } | Select-Object -First 1
$taskPaths = @($taskExisting | ForEach-Object { $_.FullName })
foreach ($taskFolder in @($taskDesktop, $taskPrograms)) {
    if (!($taskExisting | Where-Object { $_.DirectoryName -eq $taskFolder })) { $taskPaths += Join-Path $taskFolder '1a2o.lnk' }
}
if ($EnableStartup -and !($taskExisting | Where-Object { $_.DirectoryName -eq $taskStartup })) {
    $taskPaths += Join-Path $taskStartup '1a2o Background.lnk'
}
foreach ($taskPath in $taskPaths) {
    if (!(Test-Path -LiteralPath $taskPath) -and $taskTemplate) { Copy-Item -LiteralPath $taskTemplate.FullName -Destination $taskPath }
    $taskLink = $taskShell.CreateShortcut($taskPath)
    $taskLink.TargetPath = $taskPython
    $taskLink.Arguments = '"' + $taskEntry + '"' + $(if ((Split-Path $taskPath) -eq $taskStartup) { ' --services-only' } else { '' })
    $taskLink.WorkingDirectory = $Root
    $taskLink.IconLocation = $taskIcon + ',0'
    $taskLink.Description = '1a2o'
    $taskLink.WindowStyle = $(if ((Split-Path $taskPath) -eq $taskStartup) { 7 } else { 1 })
    $taskLink.Save()
    $taskNewName = if ((Split-Path $taskPath) -eq $taskStartup) { '1a2o Background.lnk' } else { '1a2o.lnk' }
    $taskRenamed = Join-Path (Split-Path $taskPath) $taskNewName
    if ($taskPath -ne $taskRenamed -and !(Test-Path -LiteralPath $taskRenamed)) { Move-Item -LiteralPath $taskPath -Destination $taskRenamed }
}
$taskMailScript = Get-Content -Raw -LiteralPath (Join-Path $Root 'scripts/local-openrouter/register-windows-mail.ps1')
& ([scriptblock]::Create($taskMailScript)) -LauncherPath $taskPython -LauncherArguments ('"' + $taskEntry + '"') -IconPath $taskIcon
Write-Output "Updated $($taskPaths.Count) 1a2o shortcuts, including the pinned taskbar and background startup."
