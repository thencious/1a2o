$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
$taskInput = [Console]::In.ReadToEnd() | ConvertFrom-Json
$taskRoot = [string]$taskInput.root
$taskConfig = Get-Content -LiteralPath (Join-Path $taskRoot '.context/desktop/launcher.json') -Raw | ConvertFrom-Json
$taskAppId = [string]$taskConfig.appUserModelId
$taskPython = [string]$taskInput.python
if (!$taskPython) { $taskPython = (Get-Command python.exe -ErrorAction Stop).Source }
if (!(Test-Path -LiteralPath $taskPython)) { $taskPython = (Get-Command $taskPython -ErrorAction Stop).Source }
$taskPythonWindowless = Join-Path (Split-Path $taskPython) 'pythonw.exe'
if (!(Test-Path -LiteralPath $taskPythonWindowless)) { throw 'Windowless Python is required for notification clicks.' }
$taskHandler = Join-Path $taskRoot 'scripts/local-openrouter/open_notification.py'
$taskProtocol = 'HKCU:\Software\Classes\open-inbox-zero'
New-Item -Path $taskProtocol -Force | Out-Null
Set-Item -Path $taskProtocol -Value 'URL:1a2o'
New-ItemProperty -Path $taskProtocol -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
New-Item -Path "$taskProtocol\shell\open\command" -Force | Out-Null
Set-Item -Path "$taskProtocol\shell\open\command" -Value ('"' + $taskPythonWindowless + '" "' + $taskHandler + '" "%1"')
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
$null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime]
$taskNotifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($taskAppId)
$taskTabNames = @{ mail = 'Mail'; messages = 'Messages'; todo = 'Tasks'; agents = 'Agents' }
$taskDelivered = @()
foreach ($taskEvent in $taskInput.events) {
    $taskLaunch = 'open-inbox-zero://open?path=' + [Uri]::EscapeDataString([string]$taskEvent.path)
    $taskEscape = [System.Security.SecurityElement]
    $taskXml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $taskXml.LoadXml('<toast activationType="protocol" launch="' + $taskEscape::Escape($taskLaunch) + '"><visual><binding template="ToastGeneric"><text>' + $taskEscape::Escape([string]$taskEvent.title) + '</text><text>' + $taskEscape::Escape([string]$taskEvent.body) + '</text><text placement="attribution">1a2o · ' + $taskEscape::Escape([string]$taskTabNames[[string]$taskEvent.tab]) + '</text></binding></visual></toast>')
    $taskToast = [Windows.UI.Notifications.ToastNotification]::new($taskXml)
    $taskToast.Tag = ([string]$taskEvent.id).Substring(0,16)
    $taskToast.Group = [string]$taskEvent.tab
    $taskToast.ExpirationTime = [DateTimeOffset]::UtcNow.AddDays(2)
    $taskNotifier.Show($taskToast)
    $taskDelivered += [string]$taskEvent.id
}
@{ ids = @($taskDelivered); setting = 'submitted' } | ConvertTo-Json -Compress
