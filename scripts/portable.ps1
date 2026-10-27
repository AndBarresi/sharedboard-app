param(
    [switch]$NoBrowser,
    [switch]$Stop,
    [switch]$OpenData,
    [ValidateRange(1024,65000)][int]$PreferredPort = 4317
)

$ErrorActionPreference = 'Stop'
$boardPackageRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$boardAppRoot = Join-Path $boardPackageRoot 'app'
$boardEntry = Join-Path $boardAppRoot 'server\index.mjs'
$boardNode = Join-Path $boardPackageRoot 'runtime\node.exe'
$boardData = Join-Path $boardPackageRoot 'data'
$boardConnectionFile = Join-Path $boardData '.connection.json'
$boardChild = $null
$boardMutex = $null
$boardHasLock = $false

function Test-SameBoardPath([string]$Left, [string]$Right) {
    if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) { return $false }
    try {
        $boardLeft = [System.IO.Path]::GetFullPath($Left).TrimEnd('\','/')
        $boardRight = [System.IO.Path]::GetFullPath($Right).TrimEnd('\','/')
        return [string]::Equals($boardLeft,$boardRight,[StringComparison]::OrdinalIgnoreCase)
    } catch { return $false }
}

function Get-BoardProcess([int]$ProcessId) {
    if ($ProcessId -le 0) { return $null }
    $boardProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
    if (-not $boardProcess -or -not (Test-SameBoardPath $boardProcess.ExecutablePath $boardNode)) { return $null }
    $boardCommand = [string]$boardProcess.CommandLine
    $boardQuotedEntry = '"' + $boardEntry + '"'
    $boardBareEntry = '(?:^|\s)' + [regex]::Escape($boardEntry) + '(?:\s|$)'
    if (-not $boardCommand.Contains($boardQuotedEntry) -and $boardCommand -notmatch $boardBareEntry) { return $null }
    return $boardProcess
}

function Get-BoardConnection {
    if (-not (Test-Path -LiteralPath $boardConnectionFile -PathType Leaf)) { return $null }
    try {
        $boardConnection = Get-Content -LiteralPath $boardConnectionFile -Raw | ConvertFrom-Json
        if (-not (Test-SameBoardPath $boardConnection.projectRoot $boardAppRoot)) { return $null }
        if (-not (Test-SameBoardPath $boardConnection.dataDir $boardData)) { return $null }
        if ([string]$boardConnection.url -notmatch '^http://127\.0\.0\.1:[0-9]+$') { return $null }
        if ([string]$boardConnection.token -notmatch '^[a-f0-9]{64}$') { return $null }
        if (-not (Get-BoardProcess ([int]$boardConnection.pid))) { return $null }
        return $boardConnection
    } catch { return $null }
}

function Test-BoardReady($Connection) {
    if (-not $Connection) { return $false }
    try {
        $boardHealth = Invoke-RestMethod -Uri ($Connection.url + '/api/health') -TimeoutSec 2
        if (-not $boardHealth.ok -or $boardHealth.name -ne 'shared-board') { return $false }
        $boardSession = Invoke-RestMethod -Uri ($Connection.url + '/api/session') -TimeoutSec 2
        return [string]::Equals([string]$boardSession.token,[string]$Connection.token,[StringComparison]::Ordinal)
    } catch { return $false }
}

function Find-BoardPort {
    for ($boardPort = $PreferredPort; $boardPort -lt ($PreferredPort + 100); $boardPort++) {
        $boardListener = $null
        try {
            $boardListener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback,$boardPort)
            $boardListener.Start()
            return $boardPort
        } catch {
            # An occupied port belongs to another app or another extracted copy.
        } finally {
            if ($boardListener) { $boardListener.Stop() }
        }
    }
    throw 'No local port was available. Close another local development app, then try again.'
}

try {
    if (-not (Test-Path -LiteralPath $boardNode -PathType Leaf)) { throw 'The bundled runtime is missing. Extract the entire ZIP before opening Start SharedBoard.app.cmd.' }
    if (-not (Test-Path -LiteralPath $boardEntry -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $boardAppRoot 'dist\index.html') -PathType Leaf)) { throw 'Some application files are missing. Extract the entire ZIP into a normal writable folder and try again.' }
    New-Item -ItemType Directory -Path $boardData -Force | Out-Null
    $boardProbe = Join-Path $boardData ('.write-check-' + [guid]::NewGuid().ToString('N'))
    [System.IO.File]::WriteAllText($boardProbe,'write check')
    Remove-Item -LiteralPath $boardProbe

    if ($OpenData) {
        Start-Process -FilePath explorer.exe -ArgumentList @('"' + $boardData + '"') | Out-Null
        exit 0
    }

    $boardHash = [System.Security.Cryptography.SHA256]::Create()
    try { $boardMutexSuffix = [BitConverter]::ToString($boardHash.ComputeHash([Text.Encoding]::UTF8.GetBytes($boardPackageRoot.ToLowerInvariant()))).Replace('-','').Substring(0,24) }
    finally { $boardHash.Dispose() }
    $boardMutex = [System.Threading.Mutex]::new($false,('Local\SharedBoard.app-' + $boardMutexSuffix))
    try { $boardHasLock = $boardMutex.WaitOne(30000) } catch [System.Threading.AbandonedMutexException] { $boardHasLock = $true }
    if (-not $boardHasLock) { throw 'Another launch or shutdown is still in progress for this copy. Wait a moment and try again.' }

    $boardConnection = Get-BoardConnection
    if ($Stop) {
        if ($boardConnection) {
            Stop-Process -Id ([int]$boardConnection.pid) -ErrorAction Stop
            Write-Output 'SharedBoard.app stopped. Your boards remain in this package''s data folder.'
        } else {
            Write-Output 'No matching SharedBoard.app process is running for this extracted copy.'
        }
        exit 0
    }

    if ($boardConnection -and -not (Test-BoardReady $boardConnection)) {
        throw 'This copy is already running but is not responding. Open Stop SharedBoard.app.cmd, then open Start SharedBoard.app.cmd again.'
    }
    if (-not $boardConnection) {
        $boardPort = Find-BoardPort
        $env:WHITEBOARD_DATA_DIR = $boardData
        $env:PORT = [string]$boardPort
        $env:NODE_ENV = 'production'
        $boardChild = Start-Process -FilePath $boardNode -ArgumentList @('"' + $boardEntry + '"') -WorkingDirectory $boardAppRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $boardData 'server.log') -RedirectStandardError (Join-Path $boardData 'server-error.log') -PassThru
        for ($boardAttempt = 0; $boardAttempt -lt 100; $boardAttempt++) {
            Start-Sleep -Milliseconds 250
            $boardChild.Refresh()
            if ($boardChild.HasExited) { throw 'The local service stopped during startup. See data\server-error.log for details.' }
            $boardCandidate = Get-BoardConnection
            if ($boardCandidate -and [int]$boardCandidate.pid -eq $boardChild.Id -and (Test-BoardReady $boardCandidate)) { $boardConnection = $boardCandidate; break }
        }
        if (-not $boardConnection) { throw 'The local service did not become ready. See data\server-error.log, or try extracting to a writable folder.' }
    }
    $boardUrl = $boardConnection.url + '/'
    Write-Output ('SharedBoard.app is ready at ' + $boardUrl)
    Write-Output 'Keep this extracted folder together. Use Stop SharedBoard.app.cmd when finished.'
    if (-not $NoBrowser) { Start-Process -FilePath $boardUrl | Out-Null }
} catch {
    if ($boardChild -and (Get-BoardProcess $boardChild.Id)) { Stop-Process -Id $boardChild.Id -ErrorAction SilentlyContinue }
    $boardMessage = $_.Exception.Message
    try { Add-Content -LiteralPath (Join-Path $boardData 'launcher-error.log') -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $boardMessage) } catch { }
    Write-Host ('SharedBoard.app could not complete this action: ' + $boardMessage) -ForegroundColor Red
    Write-Host 'Use Extract All first. Choose a folder you can write to, such as Documents. Do not run the app from inside the ZIP.'
    exit 1
} finally {
    if ($boardHasLock -and $boardMutex) { $boardMutex.ReleaseMutex() }
    if ($boardMutex) { $boardMutex.Dispose() }
}
