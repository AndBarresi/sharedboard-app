# SharedBoard.app — Andrew Barresi (https://github.com/AndBarresi). MIT.
param([switch]$Install,[switch]$Start,[switch]$Stop,[switch]$NoBrowser,[string]$InstallDir,[switch]$SkipProtocolRegistration,[ValidateRange(1,65535)][int]$Port=4319)
$ErrorActionPreference = 'Stop'
$bridgeSourceRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$bridgeTargetRoot = if ($InstallDir) { [IO.Path]::GetFullPath($InstallDir) } elseif ($Install) { [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'SharedBoardBridge')) } else { $bridgeSourceRoot }
$bridgeDataRoot = Join-Path $bridgeTargetRoot 'data'
$bridgeLaunchFile = Join-Path $bridgeDataRoot 'launcher.json'
$bridgeNode = Join-Path $bridgeTargetRoot 'runtime\node.exe'
$bridgeEntry = Join-Path $bridgeTargetRoot 'app\bridge\index.mjs'
$bridgeChild = $null
$bridgeChildCreated = $null
$bridgeMutex = $null
$bridgeHasLock = $false
$bridgePackageFiles = @('bridge.ps1','README.txt','LICENSE','AUTHORS.md','package-manifest.json','Start SharedBoard Bridge.cmd','Stop SharedBoard Bridge.cmd','Install SharedBoard Bridge.cmd')

function Test-SameBridgePath([string]$Left,[string]$Right) {
    if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) { return $false }
    try { return [String]::Equals([IO.Path]::GetFullPath($Left).TrimEnd('\','/'),[IO.Path]::GetFullPath($Right).TrimEnd('\','/'),[StringComparison]::OrdinalIgnoreCase) } catch { return $false }
}
function Read-BridgeHealth([int]$BridgePort) {
    try { return Invoke-RestMethod -Uri ('http://127.0.0.1:' + $BridgePort + '/bridge/health') -TimeoutSec 2 } catch { return $null }
}
function Get-BridgeProcess([int]$ProcessId,[int]$BridgePort,[string]$Created) {
    if ($ProcessId -le 0) { return $null }
    $bridgeRunning = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $bridgeRunning -or -not (Test-SameBridgePath $bridgeRunning.ExecutablePath $bridgeNode)) { return $null }
    # Match the entire argument list. A substring match or a reused PID is not ownership.
    $bridgeNodePattern = [regex]::Escape($bridgeNode)
    $bridgeCommandPattern = '^\s*(?:"' + $bridgeNodePattern + '"|' + $bridgeNodePattern + ')\s+"' + [regex]::Escape($bridgeEntry) + '"\s+--port\s+' + $BridgePort + '\s+--data-dir\s+"' + [regex]::Escape($bridgeDataRoot) + '"\s*$'
    if ([string]$bridgeRunning.CommandLine -notmatch $bridgeCommandPattern) { return $null }
    if ($Created -and -not [String]::Equals($Created,$bridgeRunning.CreationDate.ToUniversalTime().ToString('o'),[StringComparison]::Ordinal)) { return $null }
    return $bridgeRunning
}
function Get-OwnedBridge {
    if (-not (Test-Path -LiteralPath $bridgeLaunchFile -PathType Leaf)) { return $null }
    try {
        $bridgeSaved = Get-Content -LiteralPath $bridgeLaunchFile -Raw | ConvertFrom-Json
        if ($bridgeSaved.schemaVersion -ne 1 -or -not (Test-SameBridgePath $bridgeSaved.root $bridgeTargetRoot) -or -not (Test-SameBridgePath $bridgeSaved.dataDir $bridgeDataRoot)) { return $null }
        if ([string]$bridgeSaved.bridgeId -notmatch '^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$' -or -not $bridgeSaved.created) { return $null }
        if ([int]$bridgeSaved.port -lt 1 -or [int]$bridgeSaved.port -gt 65535) { return $null }
        $bridgeRunning = Get-BridgeProcess ([int]$bridgeSaved.pid) ([int]$bridgeSaved.port) ([string]$bridgeSaved.created)
        if (-not $bridgeRunning) { return $null }
        return @{process=$bridgeRunning;saved=$bridgeSaved}
    } catch { return $null }
}
function Stop-OwnedBridge {
    $bridgeOwned = Get-OwnedBridge
    if (-not $bridgeOwned) { return $false }
    Stop-Process -Id $bridgeOwned.process.ProcessId -ErrorAction Stop
    for ($bridgeWait=0; $bridgeWait -lt 40; $bridgeWait++) {
        if (-not (Get-BridgeProcess $bridgeOwned.process.ProcessId $bridgeOwned.saved.port $bridgeOwned.saved.created)) { return $true }
        Start-Sleep -Milliseconds 100
    }
    throw 'The bridge is still stopping. Wait a moment before trying again.'
}
function Assert-NoBridgeLinks([string]$Directory) {
    $bridgeItem = Get-Item -LiteralPath $Directory -Force
    if (($bridgeItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Install bridge files in a normal folder, without filesystem links.' }
    if ($bridgeItem.PSIsContainer) { foreach ($bridgeNested in Get-ChildItem -LiteralPath $Directory -Force) { Assert-NoBridgeLinks $bridgeNested.FullName } }
}
function Assert-BridgeWritable {
    New-Item -ItemType Directory -Path $bridgeDataRoot -Force | Out-Null
    $bridgeProbe = Join-Path $bridgeDataRoot ('.write-check-' + [guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllText($bridgeProbe,'write check')
    Remove-Item -LiteralPath $bridgeProbe
}
try {
    # This switch is only for an explicit isolated installation, never an environment unlock.
    if ($SkipProtocolRegistration -and (-not $Install -or -not $InstallDir)) { throw '-SkipProtocolRegistration requires -Install and an explicit -InstallDir.' }
    if ($Stop -and ($Install -or $Start)) { throw 'Choose one action: install, start, or stop.' }
    $bridgeMutex = [Threading.Mutex]::new($false,'Local\SharedBoardBridge-launcher')
    try { $bridgeHasLock = $bridgeMutex.WaitOne(30000) } catch [Threading.AbandonedMutexException] { $bridgeHasLock = $true }
    if (-not $bridgeHasLock) { throw 'Another bridge installation or launch is in progress. Wait a moment, then try again.' }
    if ($Stop) {
        if (Stop-OwnedBridge) { Write-Output 'SharedBoard Bridge is stopped. Saved browser boards are preserved.' }
        else { Write-Output 'No matching SharedBoard Bridge process is running for this copy.' }
        exit 0
    }
    if ($Install) {
        foreach ($bridgeRequired in (@('runtime\node.exe','app\bridge\index.mjs','app\bridge\agent-cli.mjs','app\package.json') + $bridgePackageFiles)) {
            if (-not (Test-Path -LiteralPath (Join-Path $bridgeSourceRoot $bridgeRequired) -PathType Leaf)) { throw 'Extract the whole ZIP before installing SharedBoard Bridge.' }
        }
        foreach ($bridgeItem in (@('runtime','app') + $bridgePackageFiles)) { Assert-NoBridgeLinks (Join-Path $bridgeSourceRoot $bridgeItem) }
        if (Test-Path -LiteralPath $bridgeTargetRoot) {
            $bridgeTargetItem = Get-Item -LiteralPath $bridgeTargetRoot -Force
            if (($bridgeTargetItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'The bridge installation folder must not be a filesystem link.' }
            foreach ($bridgeItem in (@('runtime','app') + $bridgePackageFiles)) { $bridgeExisting=Join-Path $bridgeTargetRoot $bridgeItem; if (Test-Path -LiteralPath $bridgeExisting) { Assert-NoBridgeLinks $bridgeExisting } }
        }
        $null = Stop-OwnedBridge
        New-Item -ItemType Directory -Path $bridgeTargetRoot -Force | Out-Null
        Assert-BridgeWritable
        if (-not [String]::Equals($bridgeSourceRoot,$bridgeTargetRoot,[StringComparison]::OrdinalIgnoreCase)) {
            foreach ($bridgeItem in @('runtime','app')) {
                $bridgeDestination = Join-Path $bridgeTargetRoot $bridgeItem
                New-Item -ItemType Directory -Path $bridgeDestination -Force | Out-Null
                foreach ($bridgeSourceItem in Get-ChildItem -LiteralPath (Join-Path $bridgeSourceRoot $bridgeItem) -Force) { Copy-Item -LiteralPath $bridgeSourceItem.FullName -Destination $bridgeDestination -Recurse -Force }
            }
            foreach ($bridgeItem in $bridgePackageFiles) { Copy-Item -LiteralPath (Join-Path $bridgeSourceRoot $bridgeItem) -Destination (Join-Path $bridgeTargetRoot $bridgeItem) -Force }
        }
        if (-not $SkipProtocolRegistration) {
        $bridgeProtocol = 'HKCU:\Software\Classes\sharedboard-bridge'
        New-Item -Path $bridgeProtocol -Force | Out-Null
        Set-Item -Path $bridgeProtocol -Value 'URL:SharedBoard Bridge'
        New-ItemProperty -Path $bridgeProtocol -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
        New-Item -Path "$bridgeProtocol\shell\open\command" -Force | Out-Null
        $bridgePowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        # The URI itself is deliberately not inserted into this command.
        $bridgeOpenCommand = '"' + $bridgePowerShell + '" -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $bridgeTargetRoot 'bridge.ps1') + '" -Start -NoBrowser'
        Set-Item -Path "$bridgeProtocol\shell\open\command" -Value $bridgeOpenCommand
        }
    }
    $bridgeNode = Join-Path $bridgeTargetRoot 'runtime\node.exe'
    $bridgeEntry = Join-Path $bridgeTargetRoot 'app\bridge\index.mjs'
    if (-not (Test-Path -LiteralPath $bridgeNode -PathType Leaf) -or -not (Test-Path -LiteralPath $bridgeEntry -PathType Leaf)) { throw 'Extract the whole bridge ZIP, then open Install SharedBoard Bridge.cmd.' }
    $bridgeOwned = Get-OwnedBridge
    if ($bridgeOwned) {
        if ($bridgeOwned.saved.port -ne $Port) { throw 'This copy is already running on another local port. Stop it before restarting on a different port.' }
        $bridgeHealth = Read-BridgeHealth $Port
        if (-not $bridgeHealth -or $bridgeHealth.product -ne 'SharedBoard Bridge' -or $bridgeHealth.bridgeId -ne $bridgeOwned.saved.bridgeId) { throw 'This bridge is running but not responding correctly. Open Stop SharedBoard Bridge.cmd, then start it again.' }
        Write-Output 'SharedBoard Bridge is already available for this installation.'
    }
    else {
        $bridgeHealth = Read-BridgeHealth $Port
        if ($bridgeHealth) { throw ('Port ' + $Port + ' is already used by another service or bridge installation. Stop that copy before starting this one.') }
        $bridgeListener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,$Port)
        try { $bridgeListener.Start() } catch { throw ('Port ' + $Port + ' is already used by another application. Close that application before starting this bridge.') } finally { $bridgeListener.Stop() }
        Assert-BridgeWritable
        $bridgeArgumentLine = '"' + $bridgeEntry + '" --port ' + $Port + ' --data-dir "' + $bridgeDataRoot + '"'
        $bridgeChild = Start-Process -FilePath $bridgeNode -ArgumentList $bridgeArgumentLine -WorkingDirectory $bridgeTargetRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $bridgeDataRoot 'bridge.log') -RedirectStandardError (Join-Path $bridgeDataRoot 'bridge-error.log')
        $bridgeProcess = Get-BridgeProcess $bridgeChild.Id $Port ''
        if (-not $bridgeProcess) { throw 'The bridge process could not be identified safely. Check data\bridge-error.log.' }
        $bridgeChildCreated = $bridgeProcess.CreationDate.ToUniversalTime().ToString('o')
        $bridgeDeadline = [DateTime]::UtcNow.AddSeconds(15)
        do {
            Start-Sleep -Milliseconds 250
            $bridgeChild.Refresh()
            if ($bridgeChild.HasExited) { throw 'The bridge could not start. Check data\bridge-error.log, or check whether port 4319 is occupied.' }
            $bridgeHealth = Read-BridgeHealth $Port
        } while (-not $bridgeHealth -and [DateTime]::UtcNow -lt $bridgeDeadline)
        if (-not $bridgeHealth -or $bridgeHealth.product -ne 'SharedBoard Bridge') { throw 'The bridge did not become ready. Reopen the launcher to retry.' }
        @{schemaVersion=1;pid=$bridgeChild.Id;created=$bridgeChildCreated;port=$Port;bridgeId=$bridgeHealth.bridgeId;root=$bridgeTargetRoot;dataDir=$bridgeDataRoot} | ConvertTo-Json | Set-Content -LiteralPath $bridgeLaunchFile -Encoding UTF8
        Write-Host 'SharedBoard Bridge is ready. Return to the webpage and choose Check bridge.'
    }
    if (-not $NoBrowser) { Start-Process -FilePath 'https://sharedboard.app/' | Out-Null }
} catch {
    if ($bridgeChild -and (Get-BridgeProcess $bridgeChild.Id $Port $bridgeChildCreated)) { Stop-Process -Id $bridgeChild.Id -ErrorAction SilentlyContinue }
    $bridgeMessage = $_.Exception.Message
    try { Add-Content -LiteralPath (Join-Path $bridgeDataRoot 'launcher-error.log') -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $bridgeMessage) } catch { }
    Write-Host ('SharedBoard Bridge could not complete this action: ' + $bridgeMessage) -ForegroundColor Red
    exit 1
} finally {
    if ($bridgeHasLock -and $bridgeMutex) { $bridgeMutex.ReleaseMutex() }
    if ($bridgeMutex) { $bridgeMutex.Dispose() }
}
