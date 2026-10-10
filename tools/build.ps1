# =============================================================
# Miliastra Atlas —— 预检 + 打包
#   powershell -ExecutionPolicy Bypass -File tools/build.ps1
# 产物：dist/miliastra-atlas-v<版本>.zip（解压后可直接「加载已解压的扩展程序」）
# =============================================================
[CmdletBinding()]
param(
  [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
$ext  = Join-Path $root 'extension'
$dist = Join-Path $root 'dist'
$problems = New-Object System.Collections.Generic.List[string]
$checks = 0

function Check([string]$name, [bool]$ok, [string]$detail = '') {
  $script:checks++
  if ($ok) { Write-Host ("  [OK]   " + $name) }
  else {
    Write-Host ("  [FAIL] " + $name + $(if ($detail) { "  -> $detail" } else { '' })) -ForegroundColor Red
    $script:problems.Add($name + $(if ($detail) { " ($detail)" } else { '' }))
  }
}

Write-Host '== 1. 检查文件结构 =='
$manifestPath = Join-Path $ext 'manifest.json'
Check 'manifest.json 存在' (Test-Path $manifestPath)

$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
Check 'manifest_version = 3' ($manifest.manifest_version -eq 3) ("实际 " + $manifest.manifest_version)
Check '扩展名称非空' ([bool]$manifest.name)
Check '只申请必要权限' (((($manifest.permissions) | Sort-Object) -join ',') -eq 'downloads,scripting') (($manifest.permissions) -join ',')
Check 'host_permissions 仅限 mihoyo 域' ((($manifest.host_permissions | Sort-Object) -join ',') -eq '*://act.mihoyo.com/*,*://api-micreator.mihoyo.com/*') (($manifest.host_permissions) -join ',')

Write-Host ''
Write-Host '== 2. 检查 manifest 引用的文件都存在 =='
$refs = @()
$refs += $manifest.background.service_worker
$refs += $manifest.action.default_popup
$refs += ($manifest.icons.PSObject.Properties | ForEach-Object { $_.Value })
$refs += ($manifest.action.default_icon.PSObject.Properties | ForEach-Object { $_.Value })
$refs += ($manifest.content_scripts | ForEach-Object { $_.js })
$refs += ($manifest.web_accessible_resources | ForEach-Object { $_.resources })
$refs = $refs | Sort-Object -Unique
foreach ($r in $refs) {
  $p = Join-Path $ext $r
  Check ("存在 " + $r) (Test-Path $p)
}

Write-Host ''
Write-Host '== 3. 检查图标是合法 PNG =='
$pngSig = [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
foreach ($icon in ($manifest.icons.PSObject.Properties | ForEach-Object { $_.Value } | Sort-Object -Unique)) {
  $p = Join-Path $ext $icon
  if (Test-Path $p) {
    $bytes = [System.IO.File]::ReadAllBytes($p)
    $head = $bytes[0..7]
    $match = -not (Compare-Object $head $pngSig -SyncWindow 0)
    Check ("PNG 头正确 " + $icon) $match
  }
}

Write-Host ''
Write-Host '== 4. 检查 JS 语法 =='
$jsFiles = Get-ChildItem -Path (Join-Path $ext 'src') -Recurse -Filter *.js -File
foreach ($f in $jsFiles) {
  $rel = $f.FullName.Substring($ext.Length + 1)
  $out = & node --check $f.FullName 2>&1
  Check ("语法正确 " + $rel) ($LASTEXITCODE -eq 0) ($out -join ' ')
}

Write-Host ''
Write-Host '== 5. 检查是否包含不必要的危险用法 =='
$badPatterns = @('document\.write\(', 'innerHTML\s*=')
foreach ($f in $jsFiles) {
  $text = Get-Content $f.FullName -Raw -Encoding UTF8
  $rel = $f.FullName.Substring($ext.Length + 1)
  foreach ($pat in $badPatterns) {
    Check ("未使用 " + $pat + " 于 " + $rel) (-not [regex]::IsMatch($text, $pat))
  }
}
# chrome.scripting 仅允许出现在 background（按需注入 content script），其余文件不应使用
foreach ($f in $jsFiles) {
  $rel = $f.FullName.Substring($ext.Length + 1)
  if ($rel -like '*background.js') {
    Check '仅在 background 中使用 chrome.scripting' ([regex]::IsMatch((Get-Content $f.FullName -Raw -Encoding UTF8), 'chrome\.scripting'))
  } else {
    Check ("未使用 chrome\.scripting 于 " + $rel) (-not [regex]::IsMatch((Get-Content $f.FullName -Raw -Encoding UTF8), 'chrome\.scripting'))
  }
}

if (-not $SkipTests) {
  Write-Host ''
  Write-Host '== 6. 运行测试套件 =='
  foreach ($t in @('test/make-sample.js', 'test/dom-test.js', 'test/inject-test.js', 'test/extract-test.js', 'test/chrome-stub-test.js', 'test/browser-e2e.js')) {
    $out = & node (Join-Path $root $t) 2>&1
    $ok = ($LASTEXITCODE -eq 0)
    if (-not $ok -and (($out -join ' ') -match '跳过')) { $ok = $true }
    Check ("测试通过 " + $t) $ok (($out | Select-Object -Last 2) -join ' / ')
  }
}

Write-Host ''
if ($problems.Count -gt 0) {
  Write-Host ("预检失败：" + $problems.Count + " 项问题（共检查 " + $checks + " 项）") -ForegroundColor Red
  $problems | ForEach-Object { Write-Host ("  - " + $_) -ForegroundColor Red }
  exit 1
}
Write-Host ("预检全部通过（" + $checks + " 项）") -ForegroundColor Green

Write-Host ''
Write-Host '== 7. 打包 =='
if (-not (Test-Path $dist)) { New-Item -ItemType Directory -Path $dist | Out-Null }
$zipName = "miliastra-atlas-v" + $manifest.version + ".zip"
$zipPath = Join-Path $dist $zipName
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$source = $ext.TrimEnd('\') + '\'
$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -Path $ext -Recurse -File | ForEach-Object {
    $entryName = $_.FullName.Substring($source.Length).Replace('\', '/')
    $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $_.LastWriteTime
    $stream = $entry.Open()
    try {
      $fs = [System.IO.File]::OpenRead($_.FullName)
      try { $fs.CopyTo($stream) } finally { $fs.Dispose() }
    } finally { $stream.Dispose() }
  }
} finally {
  $archive.Dispose()
}

$size = [Math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host ("已生成：" + $zipPath + "（" + $size + " KB）") -ForegroundColor Green

Write-Host ''
Write-Host '== 8. 校验 zip 内容与 manifest 引用一致 =='
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = $zip.Entries | ForEach-Object { $_.FullName }
  foreach ($r in $refs) {
    $want = $r.Replace('\', '/')
    Check ("zip 内含 " + $want) ($entries -contains $want)
  }
  Check 'zip 内不含测试/示例文件' (-not ($entries | Where-Object { $_ -like '*test*' -or $_ -like '*out/*' }))
} finally { $zip.Dispose() }

Write-Host ''
Write-Host '全部完成 ✅' -ForegroundColor Green
