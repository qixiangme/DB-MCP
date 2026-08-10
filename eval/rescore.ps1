# 저장된 결과 파일의 답변을 shared answerRule로 재채점한다.
# (구버전 하네스가 Latin-1로 잘못 디코딩한 한글 답변을 UTF-8로 복구 후 채점)
# 사용법: powershell -File eval\rescore.ps1 -InFile eval\results\baseline.json -Label baseline-fixed
param(
    [Parameter(Mandatory)][string]$InFile,
    [string]$Label = "rescored",
    [string]$Dataset
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $Dataset) {
    $Dataset = "$here\eval-set.json"
}
$outFile = "$here\results\$Label.json"
python "$here\rescore_results.py" --in-file $InFile --out-file $outFile --dataset $Dataset
