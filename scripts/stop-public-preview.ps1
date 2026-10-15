$ErrorActionPreference = 'Stop'
$previewRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$statePath = Join-Path $previewRoot '.tools\public-preview\processes.json'
if (!(Test-Path -LiteralPath $statePath)) { Write-Output 'No preview has been started.'; exit 0 }
$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
if ($state.workspace -ne $previewRoot) { throw 'Preview metadata belongs to another workspace.' }
foreach ($role in @('server', 'tunnel')) {
    $previewPid = $state.($role + 'Pid')
    $previewStartedAt = $state.($role + 'StartedAt')
    $process = Get-Process -Id $previewPid -ErrorAction SilentlyContinue
    if (!$process) { continue }
    if ($process.StartTime.ToUniversalTime().ToString('o') -ne $previewStartedAt) { throw 'A process ID has been reused. Refusing to stop an unrelated process.' }
    $expectedExe = if ($role -eq 'server') { (Get-Command node.exe).Source } else { Join-Path $previewRoot '.tools\cloudflared.exe' }
    if ($process.Path -ne $expectedExe) { throw 'The process executable does not match this preview.' }
    Stop-Process -Id $previewPid
}
Write-Output 'The public preview has stopped. Firestore records are preserved.'
