#!/bin/bash
# OpsPilot 메모 검색 — Leader Key / Alfred / 단축키 등에서 호출.
# 쿼리를 입력받아 CLI 검색 후 결과를 TextEdit 로 띄운다.

# nvm node 자동 탐색(런처는 최소 PATH 라 nvm 을 못 찾음) → 최신 버전 사용
NODE="$(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"
[ -z "$NODE" ] && NODE="$(command -v node)"

CLI="$HOME/Documents/personal/개인프로젝트/OpsPilot/claude-opspilot/dist/cli.js"

# 쿼리 입력 다이얼로그
Q="$(osascript -e 'text returned of (display dialog "🔎 OpsPilot 메모 검색" default answer "" buttons {"취소","검색"} default button "검색")' 2>/dev/null)"
[ -z "$Q" ] && exit 0

OUT="/tmp/opspilot-result.md"
{
  echo "# 🔎 \"$Q\""
  echo
  "$NODE" "$CLI" search "$Q"
} > "$OUT" 2>&1

open -e "$OUT"
