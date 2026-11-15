param(
    [string]$Prompt = 'Instrumental cinematic fantasy adventure soundtrack for a virtual reality princess rescue demo, shimmering magical bells, warm orchestral strings, playful piano, subtle electronic pulse, uplifting heroic crescendo, 110 BPM, polished production, no vocals',
    [ValidateRange(1,380)][int]$Seconds = 30,
    [int]$Seed = 2026,
    [ValidateRange(1,32)][int]$Threads = 8,
    [string]$OutFile = 'picture-me-free-demo.wav'
)
$ErrorActionPreference = 'Stop'
$Runtime = Join-Path $PSScriptRoot 'stable-audio-3/optimized/tflite'
$Python = Join-Path $Runtime '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $Python)) { throw "Music runtime missing: $Python" }
$env:HF_HOME = Join-Path $PSScriptRoot 'cache/huggingface'
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
$env:HF_HUB_DISABLE_XET = '1'
$env:PYTHONUTF8 = '1'
$env:PYTHONUNBUFFERED = '1'
$OutputDir = Join-Path $PSScriptRoot 'output'
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$OutputPath = if ([IO.Path]::IsPathRooted($OutFile)) { $OutFile } else { Join-Path $OutputDir $OutFile }
& $Python (Join-Path $Runtime 'scripts/sa3_tflite.py') --dit medium --decoder same-l --dit-precision w8a8 --decoder-precision w8a8 --prompt $Prompt --seconds $Seconds --steps 8 --seed $Seed --threads $Threads --out $OutputPath
exit $LASTEXITCODE
