# install-scheduler.ps1
#
# Registers a Windows Task Scheduler job that runs the SleepForge analytics
# pipeline nightly at 03:00.
#
# Order:
#   1. cleanup-published  — free disk from videos that went live overnight
#   2. refresh-analytics  — pull fresh YouTube Analytics data
#   3. ingest-own-channel — sync own channel video list
#   4. score-principles   — recalculate CTR/retention lift per title principle
#   5. channel-benchmark  — update percentile distribution
#
# Usage (run as Administrator):
#   powershell -ExecutionPolicy Bypass -File scripts\install-scheduler.ps1
#
# To unregister:
#   Unregister-ScheduledTask -TaskName "SleepForge-Analytics" -Confirm:$false

$TaskName   = "SleepForge-Analytics"
$ScriptRoot = Split-Path -Parent $PSScriptRoot   # one level up from scripts\
$NodeExe    = (Get-Command node -ErrorAction Stop).Source

# Build the analytics pipeline as a single cmd.exe command chain so Task
# Scheduler can run it without needing a PowerShell session.
$Chain = @"
"$NodeExe" "$ScriptRoot\scripts\cleanup-published.js" && "$NodeExe" "$ScriptRoot\scripts\refresh-analytics.js" --age-filter 7 && "$NodeExe" "$ScriptRoot\scripts\ingest-own-channel.js" && "$NodeExe" "$ScriptRoot\scripts\score-principles.js" && "$NodeExe" "$ScriptRoot\scripts\channel-benchmark.js"
"@.Trim()

$Action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c $Chain" -WorkingDirectory $ScriptRoot
$Trigger = New-ScheduledTaskTrigger -Daily -At "03:00"
$Settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -MultipleInstances IgnoreNew `
  -StartWhenAvailable `
  -WakeToRun:$false

# Run as current user (interactive — no password stored)
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

# Remove old task if it exists
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
  -TaskName  $TaskName `
  -Action    $Action `
  -Trigger   $Trigger `
  -Settings  $Settings `
  -Principal $Principal `
  -Description "SleepForge nightly: cleanup → refresh → ingest → score → benchmark" | Out-Null

Write-Host "✓ Task '$TaskName' registered — runs daily at 03:00"
Write-Host "  To verify:  Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "  To run now: Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "  Log path:   $env:TEMP\SleepForge-Analytics.log  (redirect in chain if needed)"
