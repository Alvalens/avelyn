<#
    Brings up the whole stack, then leaves it alone.

    Nothing here is listening until this runs — no mic is opened, no brain
    session is started, no process is left running in the background. That is
    the point of a launcher rather than a login item.

    Safe to run twice: each piece is skipped if it is already up.
#>

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot

function Test-Port($port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try { $client.Connect('127.0.0.1', $port); return $true }
    catch { return $false }
    finally { $client.Dispose() }
}

function Wait-Port($port, $name, $seconds = 60) {
    for ($i = 0; $i -lt $seconds; $i++) {
        if (Test-Port $port) { Write-Host "  $name ready." -ForegroundColor Green; return $true }
        Start-Sleep -Seconds 1
    }
    Write-Host "  $name never came up." -ForegroundColor Yellow
    return $false
}

Write-Host "`nAvelyn`n" -ForegroundColor Cyan

# A first run on a machine that is not set up yet: say how to find out what
# is missing, rather than launching half a stack.
if (-not (Test-Path "$root\avatar\avatar\dist\index.html")) {
    Write-Host "  The avatar app is not built yet. Run .\Check-Avelyn.ps1 - it lists what is missing and how to fix it.`n" -ForegroundColor Yellow
    exit 1
}

# ---- VOICEVOX (her voice) -------------------------------------------------
# Must be started through the shell: a plain background launch does not
# survive, an earlier session established that.
if (Test-Port 50021) {
    Write-Host "  VOICEVOX already running." -ForegroundColor DarkGray
} else {
    $voicevox = "$env:LOCALAPPDATA\Microsoft\WinGet\Links\VOICEVOX.exe"
    if (Test-Path $voicevox) {
        Write-Host "  starting VOICEVOX..."
        Start-Process -FilePath $voicevox
        Wait-Port 50021 'VOICEVOX' | Out-Null
    } else {
        Write-Host "  VOICEVOX not found - she will not be able to speak. Run .\Check-Avelyn.ps1 for how to install it." -ForegroundColor Yellow
    }
}

# ---- AVATAR (her body, and push-to-talk) ----------------------------------
if (Test-Port 47903) {
    Write-Host "  avatar already running." -ForegroundColor DarkGray
} else {
    Write-Host "  starting avatar..."
    # Runs the existing build rather than `npm run desktop`, which rebuilds
    # first and turns every launch into a minute of vite.
    Start-Process -FilePath 'cmd.exe' -WindowStyle Hidden `
        -ArgumentList '/c', 'set NODE_ENV=production && npx electron .' `
        -WorkingDirectory "$root\avatar\avatar"
    Wait-Port 47903 'avatar' 90 | Out-Null
}

Write-Host "`n  Ready. Press Ctrl+Alt+Space to talk to her (change it in Settings -> Voice input).`n" -ForegroundColor Cyan
