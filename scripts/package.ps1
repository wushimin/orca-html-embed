$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$packageInfo = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json
$stageRoot = Join-Path $projectRoot 'release\orca-html-embed'
New-Item -ItemType Directory -Path (Join-Path $stageRoot 'dist') -Force | Out-Null
foreach ($item in @('package.json', 'README.md', 'LICENSE', 'icon.png')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $item) -Destination (Join-Path $stageRoot $item) -Force
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist\index.js') -Destination (Join-Path $stageRoot 'dist\index.js') -Force
$zipPath = Join-Path $projectRoot ("orca-html-embed-" + $packageInfo.version + '.zip')
Compress-Archive -LiteralPath $stageRoot -DestinationPath $zipPath -Force
Get-FileHash -LiteralPath $zipPath -Algorithm SHA256 | Format-List
