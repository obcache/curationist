param(
    [switch] $BuildInstaller = $true
)

$ErrorActionPreference = "Stop"

function Remove-DirectoryFast([string] $TargetDir) {
    if (-not (Test-Path -LiteralPath $TargetDir)) {
        return
    }
    $emptyDir = Join-Path $env:TEMP ("curationist-empty-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $emptyDir -Force | Out-Null
    try {
        robocopy $emptyDir $TargetDir /MIR /MT:16 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
        Remove-Item -LiteralPath $TargetDir -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $TargetDir) {
            cmd /c "rmdir /s /q `"$TargetDir`"" | Out-Null
        }
    } finally {
        Remove-Item -LiteralPath $emptyDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$distDir = Join-Path $repoRoot "dist"
$distElectronDir = Join-Path $repoRoot "dist-electron"

# Keep packaging & installer output in top-level release\ (NEVER inside dist\)
$releaseDir = Join-Path $repoRoot "release"
$stageDir = Join-Path $releaseDir "win-unpacked"
$installerOutDir = Join-Path $releaseDir "installer"
$appResourcesDir = Join-Path $stageDir "resources\app"
$electronDistDir = Join-Path $repoRoot "node_modules\electron\dist"

# Clean up any legacy dist\package or dist\installer from earlier runs before Vite empties dist\
$legacyDistPackage = Join-Path $distDir "package"
$legacyDistInstaller = Join-Path $distDir "installer"
if (Test-Path -LiteralPath $legacyDistPackage) {
    Write-Host "==> Cleaning legacy nested dist\package directory..." -ForegroundColor Yellow
    Remove-DirectoryFast $legacyDistPackage
}
if (Test-Path -LiteralPath $legacyDistInstaller) {
    Remove-DirectoryFast $legacyDistInstaller
}

# Safety guard: ensure stageDir is never inside distDir
$normDist = ([System.IO.Path]::GetFullPath($distDir).TrimEnd('\') + '\').ToLowerInvariant()
$normStage = ([System.IO.Path]::GetFullPath($stageDir).TrimEnd('\') + '\').ToLowerInvariant()
if ($normStage.StartsWith($normDist)) {
    throw "Staging directory ($stageDir) must never be inside Vite output directory ($distDir)."
}

Write-Host "==> 1. Building Curationist Vite + Electron bundles..." -ForegroundColor Cyan
Push-Location $repoRoot
try {
    npm run build:vite
    if ($LASTEXITCODE -ne 0) {
        throw "Vite/TypeScript build failed."
    }
} finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $electronDistDir)) {
    throw "Electron distribution not found at: $electronDistDir"
}

Write-Host "==> 2. Staging Windows x64 application in $stageDir..." -ForegroundColor Cyan
if (Test-Path -LiteralPath $stageDir) {
    Remove-DirectoryFast $stageDir
}
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

# Copy Electron runtime binaries using multi-threaded robocopy
robocopy $electronDistDir $stageDir /E /MT:16 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
    throw "Failed to copy Electron runtime binaries (robocopy exit code $LASTEXITCODE)."
}

# Rename electron.exe -> Curationist.exe and stamp custom multi-LOD PE icon & version metadata
$electronExe = Join-Path $stageDir "electron.exe"
$curationistExe = Join-Path $stageDir "Curationist.exe"
if (Test-Path -LiteralPath $electronExe) {
    Rename-Item -LiteralPath $electronExe -NewName "Curationist.exe" -Force
}

$pkgJson = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$iconIcoPath = Join-Path $repoRoot "build\icon.ico"
$stamperScript = Join-Path $PSScriptRoot "stamp-exe-icon.ps1"
if (-not (Test-Path -LiteralPath $iconIcoPath)) {
    throw "Brand icon not found at $iconIcoPath. Run 'npm run icons' first."
}
& powershell -NoProfile -ExecutionPolicy Bypass -File $stamperScript `
    -ExePath $curationistExe `
    -IcoPath $iconIcoPath `
    -Version $pkgJson.version
if ($LASTEXITCODE -ne 0) {
    throw "Failed to stamp custom PE icon and version info onto $curationistExe"
}

# Remove default_app.asar if present
$defaultAsar = Join-Path $stageDir "resources\default_app.asar"
if (Test-Path -LiteralPath $defaultAsar) {
    Remove-Item -LiteralPath $defaultAsar -Force
}

# Populate resources/app with ONLY the compiled renderer & main/preload bundles
$stagedDistDir = Join-Path $appResourcesDir "dist"
$stagedDistElectronDir = Join-Path $appResourcesDir "dist-electron"
New-Item -ItemType Directory -Path $stagedDistDir -Force | Out-Null
New-Item -ItemType Directory -Path $stagedDistElectronDir -Force | Out-Null

$indexHtml = Join-Path $distDir "index.html"
if (-not (Test-Path -LiteralPath $indexHtml)) {
    throw "Expected renderer entry not found at $indexHtml"
}
# Copy top-level renderer files (index.html, icon.ico, icon.png, favicon.svg)
Get-ChildItem -LiteralPath $distDir -File | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stagedDistDir $_.Name) -Force
}

$assetsDir = Join-Path $distDir "assets"
if (Test-Path -LiteralPath $assetsDir) {
    robocopy $assetsDir (Join-Path $stagedDistDir "assets") /E /MT:8 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) {
        throw "Failed to copy renderer assets."
    }
}

robocopy $distElectronDir $stagedDistElectronDir /E /MT:8 /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
if ($LASTEXITCODE -ge 8) {
    throw "Failed to copy dist-electron bundle."
}

# Copy native projectM host executable and projectM-4.dll to resources\projectm
$nativeProjectMDir = Join-Path $repoRoot "native\projectm"
$stagedProjectMDir = Join-Path $stageDir "resources\projectm"
if (Test-Path -LiteralPath $nativeProjectMDir) {
    Write-Host "==> Staging native projectM host & projectM-4.dll into resources\projectm..." -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $stagedProjectMDir -Force | Out-Null
    Copy-Item (Join-Path $nativeProjectMDir "curationist-projectm.exe") -Destination $stagedProjectMDir -Force
    Copy-Item (Join-Path $nativeProjectMDir "projectM-4.dll") -Destination $stagedProjectMDir -Force
}

$prodPkg = [ordered]@{
    name         = $pkgJson.name
    version      = $pkgJson.version
    description  = $pkgJson.description
    main         = "dist-electron/main.js"
    dependencies = $pkgJson.dependencies
}
$prodPkg | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $appResourcesDir "package.json") -Encoding UTF8

Write-Host "==> 3. Installing production node_modules into staged app..." -ForegroundColor Cyan
Push-Location $appResourcesDir
try {
    npm install --omit=dev --prefer-offline --no-package-lock --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        throw "Production npm install failed."
    }
} finally {
    Pop-Location
}

if ($BuildInstaller) {
    $isccCandidates = @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
    )
    $iscc = $isccCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $iscc) {
        Write-Warning "Inno Setup 6 (ISCC.exe) not found in standard locations. Staged files are ready in $stageDir."
        exit 0
    }

    New-Item -ItemType Directory -Path $installerOutDir -Force | Out-Null
    $issFile = Join-Path $repoRoot "installer\curationist.iss"
    Write-Host "==> 4. Compiling Windows 11 x64 Dark Mode Installer with Inno Setup..." -ForegroundColor Cyan
    & $iscc $issFile
    if ($LASTEXITCODE -ne 0) {
        throw "Inno Setup compilation failed."
    }
    Write-Host "==> Installer built successfully in $installerOutDir" -ForegroundColor Green
}
