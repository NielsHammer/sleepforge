$f = "$env:HARVEST_OUTPUT"
$done = $false; $waited = 0
while (-not $done -and $waited -lt 1800) {
    $c = Get-Content $f -Raw -EA SilentlyContinue
    if ($c -match "harvest complete|Channel harvest complete") { $done = $true }
    if (-not $done) { Start-Sleep 10; $waited += 10 }
}
if ($done) {
    Write-Output "Harvest done - running learn..."
    Set-Location C:\dev\sleepforge
    node scripts/learn-references.js 2>&1
    Write-Output "LEARN_COMPLETE"
} else { Write-Output "HARVEST_TIMEOUT" }
