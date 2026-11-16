param([switch]$Release)
$ErrorActionPreference='Stop'
$project=(Resolve-Path $PSScriptRoot).Path
$repository=(Resolve-Path (Join-Path $project '../..')).Path
$tools=Join-Path $repository '.context/android-tools'
if(-not $env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $tools 'jdk/bin/java.exe'))) { $env:JAVA_HOME=Join-Path $tools 'jdk' }
if(-not $env:ANDROID_HOME -and (Test-Path -LiteralPath (Join-Path $tools 'sdk/platforms/android-35/android.jar'))) { $env:ANDROID_HOME=Join-Path $tools 'sdk' }
$gradle=Join-Path $tools 'gradle/bin/gradle.bat'
if(-not (Test-Path -LiteralPath $gradle)) { $gradle=(Get-Command gradle -ErrorAction Stop).Source }
if(-not $env:JAVA_HOME -or -not $env:ANDROID_HOME) { throw 'Set JAVA_HOME to JDK 17 and ANDROID_HOME to an Android SDK with API 35. See docs/ANDROID.md.' }
$testDir=Join-Path $project 'build/address-tests'
New-Item -ItemType Directory -Force -Path $testDir | Out-Null
& (Join-Path $env:JAVA_HOME 'bin/javac.exe') -d $testDir (Join-Path $project 'app/src/main/java/app/oneatwoo/ServerAddress.java') (Join-Path $project 'app/src/test/java/app/oneatwoo/ServerAddressTest.java')
if($LASTEXITCODE -ne 0) { throw 'Server address test compilation failed.' }
& (Join-Path $env:JAVA_HOME 'bin/java.exe') -cp $testDir app.oneatwoo.ServerAddressTest
if($LASTEXITCODE -ne 0) { throw 'Server address tests failed.' }
if($Release -and -not $env:ANDROID_KEYSTORE_PATH) {
    $signingFile=Join-Path $repository '.context/android-signing/signing.json'
    if(-not (Test-Path -LiteralPath $signingFile)) { throw 'Release signing is required. Set the ANDROID_KEYSTORE_PATH/PASSWORD, ANDROID_KEY_ALIAS and ANDROID_KEY_PASSWORD environment variables. Keep your private key outside Git.' }
    $signing=Get-Content -LiteralPath $signingFile -Raw | ConvertFrom-Json
    $env:ANDROID_KEYSTORE_PATH=$signing.storeFile
    $env:ANDROID_KEYSTORE_PASSWORD=$signing.storePassword
    $env:ANDROID_KEY_ALIAS=$signing.keyAlias
    $env:ANDROID_KEY_PASSWORD=$signing.keyPassword
}
$variant=if($Release) {'Release'} else {'Debug'}
& $gradle -p $project --no-daemon "assemble$variant" "lint$variant" ":app:testRelay"
if($LASTEXITCODE -ne 0) { throw 'Android build or lint failed.' }
$artifacts=Join-Path $repository '.context/artifacts'
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null
$artifact=Join-Path $artifacts '1a2o-android.apk'
$apk=if($Release) {'app/build/outputs/apk/release/app-release.apk'} else {'app/build/outputs/apk/debug/app-debug.apk'}
Copy-Item -LiteralPath (Join-Path $project $apk) -Destination $artifact -Force
Write-Host "Installable APK: $artifact"
Get-FileHash -LiteralPath $artifact -Algorithm SHA256
