# 저장된 결과 파일의 답변을 재채점한다.
# (구버전 하네스가 Latin-1로 잘못 디코딩한 한글 답변을 UTF-8로 복구 후 채점)
# 사용법: powershell -File eval\rescore.ps1 -InFile eval\results\baseline.json -Label baseline-fixed
param(
    [Parameter(Mandatory)][string]$InFile,
    [string]$Label = "rescored"
)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$evalSet = (Get-Content "$here\eval-set.json" -Raw -Encoding UTF8 | ConvertFrom-Json).questions
$keywordMap = @{}
foreach ($q in $evalSet) { $keywordMap[$q.id] = $q.keywords }

$latin1 = [System.Text.Encoding]::GetEncoding(28591)
function Repair-Mojibake([string]$s) {
    # UTF-8 바이트가 Latin-1로 디코딩된 문자열을 원상 복구.
    # 이미 정상인 한글 문자열은 Latin-1로 인코딩 불가능한 문자가 있어 그대로 반환된다.
    try {
        $bytes = $latin1.GetBytes($s)
        $fixed = [System.Text.Encoding]::UTF8.GetString($bytes)
        if ($fixed.Contains([char]0xFFFD)) { return $s }  # 복구 실패 → 원본 유지
        return $fixed
    } catch { return $s }
}

$rows = Get-Content $InFile -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($row in $rows) {
    $answer = Repair-Mojibake ([string]$row.answer)
    $row.answer = $answer
    $correct = $false
    foreach ($kw in $keywordMap[$row.id]) {
        if ($answer.IndexOf($kw, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $correct = $true; break }
    }
    $row.answerCorrect = $correct
}

$outFile = "$here\results\$Label.json"
$rows | ConvertTo-Json -Depth 4 | Out-File $outFile -Encoding utf8

$total = $rows.Count
$accuracy = [math]::Round(100.0 * ($rows | Where-Object answerCorrect).Count / $total, 1)
$routeAcc = [math]::Round(100.0 * ($rows | Where-Object routeCorrect).Count / $total, 1)
$valid = $rows | Where-Object { $_.latencyMs -ge 0 }
$avgLat = [math]::Round(($valid | Measure-Object latencyMs -Average).Average, 0)

Write-Host "===== $Label 재채점 요약 (n=$total) ====="
Write-Host "답변 정확도    : $accuracy %"
Write-Host "라우팅 적중률  : $routeAcc %"
Write-Host "평균 지연시간  : $avgLat ms"
foreach ($route in @("VECTOR", "SQL", "GRAPH")) {
    $sub = $rows | Where-Object expectedRoute -eq $route
    if ($sub.Count -gt 0) {
        $subAcc = [math]::Round(100.0 * ($sub | Where-Object answerCorrect).Count / $sub.Count, 1)
        Write-Host ("  {0,-6} 정확도: {1} % (n={2})" -f $route, $subAcc, $sub.Count)
    }
}
Write-Host "결과 저장: $outFile"
