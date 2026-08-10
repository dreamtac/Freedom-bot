$ErrorActionPreference = "Stop"
$projectPath = Split-Path -Parent $PSScriptRoot
Set-Location $projectPath

$logDirectory = Join-Path $projectPath "logs"
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $logDirectory "freedom-bot-$timestamp.log"

"[$(Get-Date -Format o)] Freedom Bot starting" | Out-File -Append -FilePath $logPath
& npm.cmd start *>> $logPath
exit $LASTEXITCODE
