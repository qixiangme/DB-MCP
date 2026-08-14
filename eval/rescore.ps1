# 저장된 결과 파일을 구조화 스키마로 정규화하면서 답변을 재채점한다.
# 사용법: powershell -File eval\rescore.ps1 -InFile eval\results\baseline.json -Label baseline-fixed
param(
    [Parameter(Mandatory)][string]$InFile,
    [string]$Label = "rescored",
    [string]$Dataset = "eval-set.json"
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$outFile = "$here\results\$Label.json"
$datasetPath = Join-Path $here $Dataset
python3 "$here/normalize_legacy_results.py" --in-file $InFile --out-file $outFile --dataset $datasetPath --label $Label
