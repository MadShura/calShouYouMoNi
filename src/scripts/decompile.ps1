# 反编译 MoNiShouYou 的 Assembly-CSharp.dll 到本仓库（反编译产物已被 .gitignore 忽略）
# 用法：powershell -ExecutionPolicy Bypass -File .\decompile.ps1
# 可选：-GameDir 指定游戏目录，-OutDir 指定输出目录

param(
    [string]$GameDir = 'D:\game\steam\steamapps\common\MoNiShouYou',
    [string]$OutDir = (Join-Path $PSScriptRoot '..\反编译')
)

$ErrorActionPreference = 'Stop'

$dll = Join-Path $GameDir 'MoNiShouYou_Data\Managed\Assembly-CSharp.dll'
if (-not (Test-Path -LiteralPath $dll)) {
    throw "找不到程序集：$dll"
}

if (-not (Get-Command ilspycmd -ErrorAction SilentlyContinue)) {
    throw '找不到 ilspycmd，请先安装：dotnet tool install -g ilspycmd'
}

$OutDir = [System.IO.Path]::GetFullPath($OutDir)
if (Test-Path -LiteralPath $OutDir) {
    Remove-Item -LiteralPath $OutDir -Recurse -Force
}
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null

Write-Host "反编译：$dll"
Write-Host "输出到：$OutDir"
ilspycmd -p -o $OutDir $dll
if ($LASTEXITCODE -ne 0) {
    throw "ilspycmd 执行失败，退出码 $LASTEXITCODE"
}

$count = (Get-ChildItem -LiteralPath $OutDir -Recurse -Filter *.cs).Count
Write-Host "完成，共 $count 个 .cs 文件"
