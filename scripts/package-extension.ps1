param(
  [string]$OutputDirectory = "dist"
)

$ErrorActionPreference = "Stop"
$workspace = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $workspace "manifest.json") -Raw |
  ConvertFrom-Json
$version = [string]$manifest.version
$output = Join-Path $workspace $OutputDirectory
$stage = Join-Path $output "gbf-extension"
$archive = Join-Path $output "gbf-extension-$version.zip"

if (Test-Path -LiteralPath $stage) {
  Remove-Item -LiteralPath $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage -Force | Out-Null

$files = @(
  "manifest.json",
  "background.js",
  "content.js",
  "page-hook.js",
  "route-planner.js",
  "service-worker.js",
  "service-worker-v2.js",
  "sidepanel.html",
  "sidepanel.css",
  "sidepanel.js"
)

foreach ($file in $files) {
  Copy-Item -LiteralPath (Join-Path $workspace $file) -Destination $stage
}

if (Test-Path -LiteralPath $archive) {
  Remove-Item -LiteralPath $archive -Force
}
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $archive
Write-Output $archive
