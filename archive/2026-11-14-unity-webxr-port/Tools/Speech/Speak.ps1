param(
    [Parameter(Mandatory = $true)][string]$Text,
    [ValidateSet('lessac', 'ryan', 'amy', 'princess')][string]$Voice = 'lessac',
    [string]$Output = '',
    [ValidateRange(0.5, 2.0)][double]$LengthScale = 1.0
)
$ErrorActionPreference = 'Stop'
if (!$Output) { $Output = Join-Path $PSScriptRoot "output\$Voice.wav" }
$Output = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Force (Split-Path $Output) | Out-Null
$piper = Join-Path $PSScriptRoot 'runtime\piper\piper.exe'
$modelVoice = $Voice
if ($Voice -eq 'princess') {
    $modelVoice = 'amy'
    if (!$PSBoundParameters.ContainsKey('LengthScale')) { $LengthScale = 0.88 }
}
$model = Join-Path $PSScriptRoot "models\en_US-$modelVoice-medium.onnx"
if (!(Test-Path $piper) -or !(Test-Path $model)) { throw 'Piper or voice model is missing. See README.md.' }
# Explicit UTF-8 keeps dialogue punctuation intact in Windows PowerShell too.
$OutputEncoding = [Text.UTF8Encoding]::new($false)
$scale = $LengthScale.ToString([Globalization.CultureInfo]::InvariantCulture)
$Text | & $piper --model $model --output_file $Output --length_scale $scale
if ($LASTEXITCODE -ne 0) { throw "Piper failed with exit code $LASTEXITCODE" }
Write-Output $Output
