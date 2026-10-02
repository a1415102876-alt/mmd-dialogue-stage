param(
    [Parameter(Mandatory=$true)][string]$Capture,
    [Parameter(Mandatory=$true)][string]$Headless,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$capturePath = (Resolve-Path -LiteralPath $Capture).Path
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
$evidencePath = Join-Path $outputPath 'evidence'
node (Join-Path $PSScriptRoot 'prepare-offline-evidence.mjs') $capturePath $evidencePath
if ($LASTEXITCODE -ne 0) { throw 'Evidence preparation failed' }
$firstRegion = (Get-Content -LiteralPath (Join-Path $evidencePath 'memory.tsv') | Select-Object -First 1) -split "`t"
$targetPath = Join-Path $evidencePath 'decomp-targets.tsv'
if (-not (Test-Path -LiteralPath $targetPath)) { throw 'Evidence contains no decompilation targets' }
$project = 'Capture-' + (Get-Date -Format 'yyyyMMddHHmmssfff')
$arguments = @($outputPath, $project, '-import', (Join-Path $evidencePath $firstRegion[3]),
    '-loader', 'BinaryLoader', '-processor', 'x86:LE:64:default', '-cspec', 'windows',
    '-loader-baseAddr', $firstRegion[1], '-noanalysis', '-scriptPath', $PSScriptRoot,
    '-preScript', 'ImportCapture.java', $evidencePath,
    '-postScript', 'ExportPhysicsDecomp.java', (Join-Path $outputPath 'runtime-decompilation.txt'), $targetPath)
& $Headless @arguments *> (Join-Path $outputPath 'ghidra.log')
if ($LASTEXITCODE -ne 0) { throw 'Ghidra failed; inspect ghidra.log' }
$decompiledPath = Join-Path $outputPath 'runtime-decompilation.txt'
if (-not (Test-Path -LiteralPath $decompiledPath)) { throw 'Ghidra produced no decompilation' }
if (Select-String -LiteralPath (Join-Path $outputPath 'ghidra.log') -Pattern 'REPORT SCRIPT ERROR|Error running script|Script does not exist' -Quiet) { throw 'Ghidra script failed; inspect ghidra.log' }
Get-Content -LiteralPath (Join-Path $outputPath 'ghidra.log') -Tail 25
