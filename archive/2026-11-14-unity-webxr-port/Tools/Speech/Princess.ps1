param([string]$Text = '', [string]$Output = '')
$ErrorActionPreference = 'Stop'
$arguments = @((Join-Path $PSScriptRoot 'qwen\design_voice.py'))
if ($Text) { $arguments += @('--text', $Text) }
if ($Output) { $arguments += @('--output', $Output) }
& (Join-Path $PSScriptRoot 'qwen\.venv\Scripts\python.exe') @arguments
if ($LASTEXITCODE -ne 0) { throw 'Qwen voice generation failed' }
