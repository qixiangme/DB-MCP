#!/bin/bash
# =============================================================================
# Go 구현 빌드 스크립트 (mcp-server-go, agent-app-go)
# =============================================================================
#
# 목적: mcp-server-go/agent-app-go를 현재 플랫폼용 실행 바이너리로 빌드
#
# 기본 실행 경로(Spring AI)는 바꾸지 않는다 — Go 구현은 air-server와 같은
# 선택형 대체 구현이며, 기본 Gradle 빌드/실행에는 포함되지 않는다.
#
# 사용법:
#   ./scripts/build-go.sh              # 현재 플랫폼용 바이너리를 bin/에 생성
#   ./scripts/build-go.sh --all        # macOS/Linux/Windows용 크로스 컴파일
#
# 결과물:
#   bin/mcp-server-go[.exe]
#   bin/agent-app-go[.exe]
# =============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$ROOT_DIR/bin"

command -v go >/dev/null 2>&1 || {
  echo "error: go가 설치되어 있지 않습니다. https://go.dev/dl/ 참고" >&2
  exit 1
}

mkdir -p "$BIN_DIR"

build_one() {
  local module="$1" os="$2" arch="$3" ext="$4"
  local out="$BIN_DIR/${module}-${os}-${arch}${ext}"
  echo "building $module for $os/$arch -> $out"
  ( cd "$ROOT_DIR/$module" && GOOS="$os" GOARCH="$arch" go build -o "$out" . )
}

if [[ "${1:-}" == "--all" ]]; then
  for module in mcp-server-go agent-app-go; do
    build_one "$module" darwin arm64 ""
    build_one "$module" darwin amd64 ""
    build_one "$module" linux amd64 ""
    build_one "$module" windows amd64 ".exe"
  done
else
  for module in mcp-server-go agent-app-go; do
    echo "building $module -> $BIN_DIR/$module"
    ( cd "$ROOT_DIR/$module" && go build -o "$BIN_DIR/$module" . )
  done
fi

echo "done. binaries in $BIN_DIR/"
