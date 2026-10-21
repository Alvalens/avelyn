<#
    Checks that everything Avelyn needs is installed, and says how to fix
    whatever is not. Changes nothing.

    One line per check: [ok], [missing] (required - exit code 1) or [note]
    (optional). Run it until there is no [missing] line, then Start-Avelyn.ps1.
    An AI agent setting this repo up can loop on the exit code.
#>

$ErrorActionPreference = 'Continue'
$root = $PSScriptRoot
$local = $env:LOCALAPPDATA
$failed = 0

function Ok($text) { Write-Host "  [ok]      $text" -ForegroundColor Green }
function Missing($text, $fix) {
    Write-Host "  [missing] $text" -ForegroundColor Yellow
    Write-Host "            -> $fix"
    $script:failed++
}
function Note($text) { Write-Host "  [note]    $text" -ForegroundColor DarkGray }

function Test-Port($port) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try { $client.Connect('127.0.0.1', $port); return $true }
    catch { return $false }
    finally { $client.Dispose() }
}

# The same lookup ears/src/brain/index.ts uses: an .exe on PATH, then where
# each CLI's own installer puts it. Only real executables count - spawn
# without a shell cannot run an npm .cmd shim.
function Find-Cli($name, $installed) {
    $onPath = Get-Command "$name.exe" -CommandType Application -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($onPath) { return $onPath.Source }
    if (Test-Path $installed) { return $installed }
    return $null
}

Write-Host "`nAvelyn - setup check`n" -ForegroundColor Cyan

# ---- Node ------------------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Missing 'Node.js' 'install Node 24 or newer: winget install OpenJS.NodeJS.LTS'
} else {
    $version = (& node --version) -replace '^v', ''
    if ([int]($version.Split('.')[0]) -ge 24) { Ok "Node $version" }
    else { Missing "Node $version is too old" 'install Node 24 or newer: winget install OpenJS.NodeJS.LTS' }
}

# ---- npm installs and the app build ------------------------------------------
$app = Join-Path $root 'avatar\avatar'
$engine = Join-Path $root 'engine'
if (Test-Path (Join-Path $app 'node_modules')) { Ok 'avatar app dependencies' }
else { Missing 'avatar app dependencies' "cd `"$app`"; npm install" }
if (Test-Path (Join-Path $engine 'node_modules')) { Ok 'engine dependencies' }
else { Missing 'engine dependencies' "cd `"$engine`"; npm install" }
if (Test-Path (Join-Path $app 'dist\index.html')) { Ok 'avatar app is built' }
else { Missing 'avatar app is not built' "cd `"$app`"; npm run build" }

# ---- VOICEVOX (her voice) ------------------------------------------------------
$voicevox = Join-Path $local 'Microsoft\WinGet\Links\VOICEVOX.exe'
if (Test-Port 50021) { Ok 'VOICEVOX is running' }
elseif (Test-Path $voicevox) { Ok 'VOICEVOX is installed (Start-Avelyn.ps1 starts it)' }
else { Missing 'VOICEVOX' 'winget install HiroshibaKazuyuki.VOICEVOX' }

# ---- whisper (her ears) -----------------------------------------------------
$whisperDir = Join-Path $local 'avelyn\whisper'
$whisper = if ($env:WHISPER_BINARY) { $env:WHISPER_BINARY } else { Join-Path $whisperDir 'bin\Release\whisper-cli.exe' }
$model = if ($env:WHISPER_MODEL) { $env:WHISPER_MODEL } else { Join-Path $whisperDir 'models\ggml-base.en.bin' }
if (Test-Path $whisper) { Ok 'whisper-cli' }
else {
    Missing "whisper-cli ($whisper)" ("download whisper-bin-x64.zip from https://github.com/ggml-org/whisper.cpp/releases " +
        "and extract it into `"$(Join-Path $whisperDir 'bin')`" so that bin\Release\whisper-cli.exe exists")
}
if (Test-Path $model) { Ok 'whisper model' }
else {
    Missing "whisper model ($model)" ("download https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin " +
        "to `"$model`"")
}

# ---- Her brain: at least one agent CLI ---------------------------------------
$clis = [ordered]@{
    agy    = Find-Cli 'agy' (Join-Path $local 'agy\bin\agy.exe')
    claude = Find-Cli 'claude' (Join-Path $env:USERPROFILE '.local\bin\claude.exe')
    codex  = Find-Cli 'codex' (Join-Path $local 'Programs\OpenAI\Codex\bin\codex.exe')
}
$found = @($clis.Keys | Where-Object { $clis[$_] })
if ($found.Count -eq 0) {
    Missing 'an agent CLI for her brain' ('install one you have a subscription for - Claude Code, Codex or ' +
        'Antigravity (agy) - and log in to it once by running it in a terminal')
} else {
    foreach ($name in $found) { Ok "$name ($($clis[$name]))" }
    Note 'each CLI needs a one-time login by you: run it in a terminal (claude: /login, codex: codex login)'
    Note 'pick which one she uses in the app: Settings -> Brain (default agy; if that one is not installed, the first installed of claude, codex, agy)'
}

# agy is the one brain that cannot be handed the engine per launch.
if ($clis.agy) {
    $server = Join-Path $root 'engine\src\server.ts'
    $listed = (& $clis.agy mcp list 2>&1 | Out-String)
    $add = "agy mcp add avelyn-engine node -- --no-warnings `"$server`""
    # Slashes and case differ between how it was registered and this path.
    $normalize = { param($text) ($text -replace '\\', '/').ToLowerInvariant() }
    $entry = ($listed -split "`r?`n") | Where-Object { $_ -match '^\s*avelyn-engine\s' } | Select-Object -First 1
    if (-not $entry) {
        Missing 'agy does not know her tools yet' $add
    } elseif ((& $normalize $entry).Contains((& $normalize $server))) {
        Ok 'agy knows her tools (avelyn-engine, this repo)'
    } else {
        Missing 'agy has avelyn-engine registered from a different folder' "agy mcp remove avelyn-engine; $add"
    }
}

Write-Host ''
if ($failed -gt 0) {
    Write-Host "  $failed thing(s) to fix - see above, then run this again.`n" -ForegroundColor Yellow
    exit 1
}
Write-Host "  All set. Start her with .\Start-Avelyn.ps1`n" -ForegroundColor Cyan
exit 0
