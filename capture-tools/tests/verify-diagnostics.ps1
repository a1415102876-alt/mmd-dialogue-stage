param([string]$VsDevCmd = 'C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat')
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    node --check physics-trace-report.mjs
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript syntax failed' }
    node --test tests/physics-trace-report.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Report tests failed' }
    New-Item -ItemType Directory -Force build/diagnostic-check | Out-Null
    $commands = @(
        "`"$VsDevCmd`" -arch=x64 -host_arch=x64 >NUL",
        'msbuild build\gakumas_localify_dmm.sln /m /p:Configuration=Release /p:Platform=x64 /v:minimal',
        'cl /nologo /EHsc /MD /std:c++17 tests\algorithm-trace.test.cpp /Fe:build\diagnostic-check\algorithm-trace-test.exe /Fo:build\diagnostic-check\algorithm-trace-test.obj',
        'build\diagnostic-check\algorithm-trace-test.exe',
        'cl /nologo /EHsc /MD /std:c++17 tests\runtime-reference.test.cpp /Fe:build\diagnostic-check\runtime-reference-test.exe /Fo:build\diagnostic-check\runtime-reference-test.obj',
        'build\diagnostic-check\runtime-reference-test.exe',
        'cl /nologo /EHsc /MD /std:c++17 /I src tests\idol-parameter-export.test.cpp /Fe:build\diagnostic-check\idol-parameter-export-test.exe /Fo:build\diagnostic-check\idol-parameter-export-test.obj',
        'build\diagnostic-check\idol-parameter-export-test.exe',
        'cl /nologo /EHsc /MD /std:c++17 /I deps\nlohmann tests\snapshot-layout.test.cpp /Fe:build\diagnostic-check\snapshot-layout-test.exe /Fo:build\diagnostic-check\snapshot-layout-test.obj',
        'build\diagnostic-check\snapshot-layout-test.exe G:\\gkmas\\gakumas\\gakumas-local\\physics-diagnostics\\capture-2026-9-21-18-13-50-18756-54262437\\runtime-data.json',
        'cl /nologo /EHsc /MD /std:c++17 tests\native-code-references.test.cpp build\bin\x64\Release\minhook.lib /Fe:build\diagnostic-check\native-code-references-test.exe /Fo:build\diagnostic-check\native-code-references-test.obj',
        'build\diagnostic-check\native-code-references-test.exe',
        'cl /nologo /EHsc /MD /std:c++17 tests\native-capture-plan.test.cpp /Fe:build\diagnostic-check\native-capture-plan-test.exe /Fo:build\diagnostic-check\native-capture-plan-test.obj',
        'build\diagnostic-check\native-capture-plan-test.exe',
        'cl /nologo /EHsc /MD /std:c++17 tests\playable-inspection.test.cpp /Fe:build\diagnostic-check\playable-inspection-test.exe /Fo:build\diagnostic-check\playable-inspection-test.obj',
        'build\diagnostic-check\playable-inspection-test.exe',
        'cl /nologo /EHsc /MD /std:c++17 /I deps\minhook\include tests\algorithm-hook-abi.test.cpp build\bin\x64\Release\minhook.lib /Fe:build\diagnostic-check\algorithm-hook-abi-test.exe /Fo:build\diagnostic-check\algorithm-hook-abi-test.obj',
        'build\diagnostic-check\algorithm-hook-abi-test.exe'
    )
    cmd /c ($commands -join ' && ')
    if ($LASTEXITCODE -ne 0) { throw 'Native build/tests failed' }
    Get-FileHash build/bin/x64/Release/version.dll -Algorithm SHA256
} finally {
    Pop-Location
}
