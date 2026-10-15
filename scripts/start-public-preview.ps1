param([int]$Port = 3002)
$ErrorActionPreference = 'Stop'
$previewRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location -LiteralPath $previewRoot
$previewDirectory = Join-Path $previewRoot '.tools\public-preview'
New-Item -ItemType Directory -Path $previewDirectory -Force | Out-Null
$statePath = Join-Path $previewDirectory 'processes.json'
if (Test-Path -LiteralPath $statePath) {
    $previous = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $live = @(Get-Process -Id $previous.serverPid,$previous.tunnelPid -ErrorAction SilentlyContinue)
    if ($live.Count -gt 0) { throw 'A preview process is already running. Run npm run preview:stop before starting another.' }
}
$tunnelExe = Join-Path $previewRoot '.tools\cloudflared.exe'
$credentialPath = Join-Path $previewRoot '.env.render-secret'
if (!(Test-Path -LiteralPath $tunnelExe)) { throw 'The official .tools/cloudflared.exe client is required.' }
if (!(Test-Path -LiteralPath $credentialPath)) { throw 'The private Firebase runtime credential is required.' }
if (!(Test-Path -LiteralPath (Join-Path $previewRoot 'build\server\hosted-index.js'))) { throw 'Run npm run build first.' }
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) { throw ('Port ' + $Port + ' is already in use.') }
$tunnelOut = Join-Path $previewDirectory 'tunnel.out.log'
$tunnelErr = Join-Path $previewDirectory 'tunnel.err.log'
Write-Output 'Starting the temporary Cloudflare tunnel...'
$tunnelProcess = Start-Process -FilePath $tunnelExe -ArgumentList 'tunnel','--url',('http://127.0.0.1:' + $Port),'--no-autoupdate','--protocol','http2' -WorkingDirectory $previewRoot -WindowStyle Hidden -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -PassThru
$serverProcess = $null
try {
    $publicUrl = $null
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if ($tunnelProcess.HasExited) { throw 'The tunnel stopped. Check .tools/public-preview/tunnel.err.log.' }
        $logs = (Get-Content -LiteralPath $tunnelErr -Raw -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $tunnelOut -Raw -ErrorAction SilentlyContinue)
        if ($logs -match 'https://[a-z0-9-]+\.trycloudflare\.com') { $publicUrl = $Matches[0]; break }
        Start-Sleep -Seconds 1
    }
    if (!$publicUrl) { throw 'The tunnel did not provide a public URL.' }
    $env:DOTENV_CONFIG_PATH = $credentialPath
    $env:APP_ORIGIN = $publicUrl
    $env:NODE_ENV = 'production'
    $env:HOST = '127.0.0.1'
    $env:PORT = [string]$Port
    $nodeExe = (Get-Command node.exe).Source
    $serverProcess = Start-Process -FilePath $nodeExe -ArgumentList 'build/server/hosted-index.js' -WorkingDirectory $previewRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $previewDirectory 'server.out.log') -RedirectStandardError (Join-Path $previewDirectory 'server.err.log') -PassThru
    $state = [ordered]@{
        url = $publicUrl; port = $Port; workspace = $previewRoot
        serverPid = $serverProcess.Id; serverStartedAt = $serverProcess.StartTime.ToUniversalTime().ToString('o')
        tunnelPid = $tunnelProcess.Id; tunnelStartedAt = $tunnelProcess.StartTime.ToUniversalTime().ToString('o')
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath $statePath
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($serverProcess.HasExited) { throw 'The server stopped. Check .tools/public-preview/server.err.log.' }
        try {
            $health = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $Port + '/api/health') -TimeoutSec 3
            if ($health.status -eq 'ok') { $ready = $true; break }
        } catch { Start-Sleep -Seconds 1 }
    }
    if (!$ready) { throw 'The server could not confirm database readiness.' }
    Write-Output ('Public URL: ' + $publicUrl)
    Write-Output 'Firestore is ready. Keep this computer on and connected.'
    Write-Output 'Stop with: npm run preview:stop'
} catch {
    if ($serverProcess -and !$serverProcess.HasExited) { Stop-Process -Id $serverProcess.Id }
    if (!$tunnelProcess.HasExited) { Stop-Process -Id $tunnelProcess.Id }
    throw
}
