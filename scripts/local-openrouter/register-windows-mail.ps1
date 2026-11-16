param([string]$LauncherPath, [string]$IconPath, [string]$LauncherArguments = '')

$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $LauncherPath)) { throw 'The 1a2o launcher must be installed first.' }
$taskProgId = 'OpenInboxZero.Mailto'
$taskClass = "HKCU:\Software\Classes\$taskProgId"
$taskClient = 'HKCU:\Software\Clients\Mail\1a2o'
$taskBaseCommand = '"' + $LauncherPath + '"' + $(if ($LauncherArguments) { ' ' + $LauncherArguments } else { '' })
$taskCommand = $taskBaseCommand + ' "%1"'
foreach ($taskKey in @($taskClass, "$taskClass\Application", "$taskClass\DefaultIcon", "$taskClass\shell\open\command", $taskClient, "$taskClient\shell\open\command", "$taskClient\Capabilities", "$taskClient\Capabilities\URLAssociations", 'HKCU:\Software\RegisteredApplications', 'HKCU:\Software\Classes\mailto\OpenWithProgids')) {
    New-Item -Path $taskKey -Force | Out-Null
}
Set-Item -LiteralPath $taskClass -Value '1a2o email link'
New-ItemProperty -LiteralPath $taskClass -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
Set-Item -LiteralPath "$taskClass\DefaultIcon" -Value ('"' + $IconPath + '",0')
Set-Item -LiteralPath "$taskClass\shell\open\command" -Value $taskCommand
New-ItemProperty -LiteralPath "$taskClass\Application" -Name ApplicationName -Value '1a2o' -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath "$taskClass\Application" -Name ApplicationIcon -Value ('"' + $IconPath + '",0') -PropertyType String -Force | Out-Null
Set-Item -LiteralPath $taskClient -Value '1a2o'
Set-Item -LiteralPath "$taskClient\shell\open\command" -Value $taskBaseCommand
New-ItemProperty -LiteralPath "$taskClient\Capabilities" -Name ApplicationName -Value '1a2o' -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath "$taskClient\Capabilities" -Name ApplicationDescription -Value 'Compose email using your connected Gmail and Outlook mailboxes.' -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath "$taskClient\Capabilities" -Name ApplicationIcon -Value ('"' + $IconPath + '",0') -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath "$taskClient\Capabilities\URLAssociations" -Name mailto -Value $taskProgId -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath 'HKCU:\Software\RegisteredApplications' -Name '1a2o' -Value 'Software\Clients\Mail\1a2o\Capabilities' -PropertyType String -Force | Out-Null
New-ItemProperty -LiteralPath 'HKCU:\Software\Classes\mailto\OpenWithProgids' -Name $taskProgId -Value '' -PropertyType String -Force | Out-Null
Write-Output '1a2o registered for email links. Choose it for MAILTO in Windows Default apps.'
