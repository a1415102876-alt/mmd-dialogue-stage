# Upload mmd library packs to Cloudflare R2 (S3-compatible API)
# Required env:
#   CF_ACCOUNT_ID
#   R2_BUCKET
# Optional:
#   R2_PUBLIC_BASE  (e.g. https://pub-xxxx.r2.dev)
#   R2_PREFIX       (default: empty; objects keyed as idols/fktn/...)
# Uses AWS CLI + credentials from ~/.aws/credentials [default]

param(
  [string]$Source = "G:\SillyTavern\mmd-dialogue-stage-upload\library\file",
  [string]$Prefix = $env:R2_PREFIX
)

$ErrorActionPreference = 'Stop'
$account = $env:CF_ACCOUNT_ID
$bucket = $env:R2_BUCKET
if (-not $account) { throw 'Set CF_ACCOUNT_ID' }
if (-not $bucket) { throw 'Set R2_BUCKET' }
if (-not (Test-Path $Source)) { throw "Missing source: $Source" }

$endpoint = "https://$account.r2.cloudflarestorage.com"
$dest = if ([string]::IsNullOrWhiteSpace($Prefix)) { "s3://$bucket/" } else { "s3://$bucket/$($Prefix.Trim('/'))/" }

Write-Host "Endpoint: $endpoint"
Write-Host "Source:   $Source"
Write-Host "Dest:     $dest"

aws s3 sync $Source $dest `
  --endpoint-url $endpoint `
  --region auto `
  --no-progress

Write-Host 'Done.'
if ($env:R2_PUBLIC_BASE) {
  Write-Host "Public base for library.json: $($env:R2_PUBLIC_BASE.TrimEnd('/'))"
}
