$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
New-Item -ItemType Directory -Path (Join-Path $projectRoot 'evidence') -Force | Out-Null
$info = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$archive = Join-Path $projectRoot ('orca-html-embed-' + $info.version + '.zip')
$checkDir = Join-Path $projectRoot ('.verification\' + $info.version + '-' + [guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath $archive -DestinationPath $checkDir
$extracted = Join-Path $checkDir 'orca-html-embed'
$expected = @('dist/index.js', 'icon.png', 'LICENSE', 'package.json', 'README.md')
$actual = @(Get-ChildItem -LiteralPath $extracted -Recurse -File | ForEach-Object { [IO.Path]::GetRelativePath($extracted, $_.FullName).Replace('\', '/') } | Sort-Object)
if (Compare-Object $expected $actual) { throw 'Unexpected release contents' }
$files = foreach ($relative in $expected) {
    $targetFile = Join-Path $extracted $relative
    $hash = (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $sourceHash = (Get-FileHash -LiteralPath (Join-Path $projectRoot $relative) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $sourceHash) { throw "Release mismatch: $relative" }
    @{ path = 'orca-html-embed/' + $relative; bytes = (Get-Item -LiteralPath $targetFile).Length; sha256 = $hash }
}
node --check (Join-Path $extracted 'dist/index.js')
if ($LASTEXITCODE -ne 0) { throw 'Extracted entry syntax check failed' }
@{
    archive = [IO.Path]::GetFileName($archive)
    sha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    files = @($files)
    matchesSource = $true
    cleanExtractionSyntaxCheck = $true
    checkedAt = (Get-Date).ToString('o')
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $projectRoot 'evidence\release-verification.json') -Encoding utf8
Get-Content -LiteralPath (Join-Path $projectRoot 'evidence\release-verification.json')
