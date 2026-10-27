param([switch]$NoBrowser, [switch]$Stop)
$ErrorActionPreference = 'Stop'
$boardRoot = Split-Path -Parent $PSScriptRoot
$boardUrl = 'http://127.0.0.1:4317/'
$boardEntry = Join-Path $boardRoot 'server\index.mjs'
$boardData = Join-Path $boardRoot 'data'

if ($Stop) {
    $boardConnectionFile = Join-Path $boardData '.connection.json'
    if (Test-Path -LiteralPath $boardConnectionFile) {
        $boardConnection = Get-Content -LiteralPath $boardConnectionFile -Raw | ConvertFrom-Json
        $boardProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($boardConnection.pid)" -ErrorAction SilentlyContinue
        if ($boardProcess -and $boardProcess.CommandLine.Contains($boardEntry)) {
            Stop-Process -Id $boardConnection.pid
            Write-Output 'SharedBoard.app stopped. Your drawing is saved in the data folder.'
        } else { Write-Output 'No matching background SharedBoard.app process is running.' }
    }
    exit 0
}

$boardReady = $false
try { $boardReady = (Invoke-RestMethod -Uri ($boardUrl + 'api/health') -TimeoutSec 2).name -eq 'shared-board' } catch { }
if (-not $boardReady) {
    if (-not (Test-Path -LiteralPath (Join-Path $boardRoot 'dist\index.html'))) { throw 'Build the app first using the setup instructions in README.md.' }
    $boardNodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($boardNodeCommand) { $boardNodePath = $boardNodeCommand.Source }
    else { $boardNodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
    if (-not (Test-Path -LiteralPath $boardNodePath)) { throw 'Node.js 22.12 or newer is required. See README.md.' }
    New-Item -ItemType Directory -Path $boardData -Force | Out-Null
    $boardChild = Start-Process -FilePath $boardNodePath -ArgumentList @('"' + $boardEntry + '"') -WorkingDirectory $boardRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $boardData 'server.log') -RedirectStandardError (Join-Path $boardData 'server-error.log') -PassThru
    for ($boardAttempt = 0; $boardAttempt -lt 40; $boardAttempt++) {
        Start-Sleep -Milliseconds 250
        try { $boardReady = (Invoke-RestMethod -Uri ($boardUrl + 'api/health') -TimeoutSec 1).name -eq 'shared-board' } catch { }
        if ($boardReady) { break }
        if ($boardChild.HasExited) { throw 'The whiteboard could not start. See data\server-error.log.' }
    }
    if (-not $boardReady) { throw 'The whiteboard did not become ready. See data\server-error.log.' }
}
Write-Output "SharedBoard.app is ready at $boardUrl"
if (-not $NoBrowser) { Start-Process $boardUrl }
