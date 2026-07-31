# 평가 하네스: eval-set.json의 질문을 /api/chat에 던지고
# 답변 정확도(키워드 포함), 라우팅 적중률, 지연시간을 측정한다.
# 사용법: powershell -File eval\run-eval.ps1 -Label baseline -Reps 2
param(
    [string]$Label = "run",
    [int]$Reps = 2,
    [string]$BaseUrl = "http://localhost:8080",
    [string]$SetFile = "eval-set.json"
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$evalSet = (Get-Content "$here\$SetFile" -Raw -Encoding UTF8 | ConvertFrom-Json).questions
$resultsDir = "$here\results"
if (-not (Test-Path $resultsDir)) { New-Item -ItemType Directory $resultsDir | Out-Null }

$results = @()
foreach ($rep in 1..$Reps) {
    foreach ($q in $evalSet) {
        $body = [System.Text.Encoding]::UTF8.GetBytes((@{question = $q.question} | ConvertTo-Json))
        $ok = $true
        try {
            # PS 5.1의 Invoke-RestMethod는 charset 없는 JSON을 Latin-1로 디코딩하므로
            # 바이트를 직접 UTF-8로 디코딩한다 (한글 답변 채점 버그 방지)
            $resp = Invoke-WebRequest -Method Post -Uri "$BaseUrl/api/chat" `
                -ContentType "application/json; charset=utf-8" -Body $body -TimeoutSec 300 -UseBasicParsing
            $res = [System.Text.Encoding]::UTF8.GetString($resp.RawContentStream.ToArray()) | ConvertFrom-Json
        } catch {
            $ok = $false
        }
        if ($ok) {
            $answer = [string]$res.answer
            $answerCorrect = $false
            foreach ($kw in $q.keywords) {
                if ($answer.IndexOf($kw, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $answerCorrect = $true; break }
            }
            $routeCorrect = $res.routes -contains $q.expectedRoute
            $row = [pscustomobject]@{
                rep = $rep; id = $q.id; question = $q.question
                expectedRoute = $q.expectedRoute; actualRoutes = ($res.routes -join "+")
                routeCorrect = $routeCorrect; answerCorrect = $answerCorrect
                latencyMs = $res.latencyMs; answer = $answer
            }
        } else {
            $row = [pscustomobject]@{
                rep = $rep; id = $q.id; question = $q.question
                expectedRoute = $q.expectedRoute; actualRoutes = "ERROR"
                routeCorrect = $false; answerCorrect = $false
                latencyMs = -1; answer = "(request failed)"
            }
        }
        $mark = if ($row.answerCorrect) { "O" } else { "X" }
        Write-Host ("[{0} rep{1}] {2} route={3} answer={4} {5}ms" -f $row.id, $rep, $mark, $row.actualRoutes, $row.answerCorrect, $row.latencyMs)
        # 행별 JSON을 콘솔에도 남긴다 — 파일 유실 시 콘솔 로그에서 복원 가능
        Write-Host ("##ROW## " + ($row | ConvertTo-Json -Compress -Depth 4))
        $results += $row
        # 중간 저장 — 실행이 중단돼도 부분 결과가 남는다
        try { $results | ConvertTo-Json -Depth 4 | Out-File "$resultsDir\$Label.json" -Encoding utf8 } catch { Write-Host "저장 실패: $($_.Exception.Message)" }
    }
}

$outFile = "$resultsDir\$Label.json"

# ── 요약 ──────────────────────────────────────────────
$total = $results.Count
$accuracy = [math]::Round(100.0 * ($results | Where-Object answerCorrect).Count / $total, 1)
$routeAcc = [math]::Round(100.0 * ($results | Where-Object routeCorrect).Count / $total, 1)
$valid = $results | Where-Object { $_.latencyMs -ge 0 }
$avgLat = [math]::Round(($valid | Measure-Object latencyMs -Average).Average, 0)
$sorted = $valid | Sort-Object latencyMs
$median = $sorted[[math]::Floor($sorted.Count / 2)].latencyMs

Write-Host ""
Write-Host "===== $Label 요약 (n=$total) ====="
Write-Host "답변 정확도    : $accuracy %"
Write-Host "라우팅 적중률  : $routeAcc %"
Write-Host "평균 지연시간  : $avgLat ms / 중앙값: $median ms"
foreach ($route in @("VECTOR", "SQL", "GRAPH")) {
    $sub = $results | Where-Object expectedRoute -eq $route
    if ($sub.Count -gt 0) {
        $subAcc = [math]::Round(100.0 * ($sub | Where-Object answerCorrect).Count / $sub.Count, 1)
        Write-Host ("  {0,-6} 정확도: {1} % (n={2})" -f $route, $subAcc, $sub.Count)
    }
}
Write-Host "결과 저장: $outFile"
