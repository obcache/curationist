$ErrorActionPreference = 'Stop'
$vcvars = "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Compiling curationist-projectm.exe using MSVC..." -ForegroundColor Cyan

$cmd = "call `"$vcvars`" && cd /d `"$scriptDir`" && cl.exe /EHsc /O2 /W3 /D_CRT_SECURE_NO_WARNINGS /I`"E:\production\coding\projectM\src\api\include`" /I`"E:\production\coding\projectM\build\msvc2022\src\api\include`" curationist-projectm.cpp /link projectM-4.lib opengl32.lib user32.lib gdi32.lib ws2_32.lib crypt32.lib advapi32.lib ole32.lib /OUT:curationist-projectm.exe"

cmd.exe /c $cmd
if ($LASTEXITCODE -ne 0) {
    Write-Error "Compilation failed with exit code $LASTEXITCODE"
} else {
    Write-Host "Successfully compiled curationist-projectm.exe!" -ForegroundColor Green
}
