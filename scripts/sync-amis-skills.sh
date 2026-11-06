#!/usr/bin/env bash
# 作用：将本项目 .claude/skills 同步到独立仓库 gitee.com/liangxp/amis-skills 并推送。
# 用法：bash scripts/sync-amis-skills.sh [commit-message]
# 依赖：本机已 clone 到 ~/IdeaProjects/amis-skills（首次会自动 clone）。
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)/.claude/skills"
DEST="$HOME/IdeaProjects/amis-skills"
REMOTE="https://gitee.com/liangxp/amis-skills.git"
MSG="${1:-chore: sync amis skills}"

# 首次运行时自动 clone 目标仓库
if [ ! -d "$DEST/.git" ]; then
  git clone "$REMOTE" "$DEST"
fi

# rsync 镜像同步；必须排除 .git，否则 --delete 会删掉目标仓库元数据
rsync -a --delete --exclude='.git' --exclude='.DS_Store' "$SRC/" "$DEST/"

cd "$DEST"
if git diff --quiet && git diff --cached --quiet; then
  echo "skills 无变化，跳过推送"
  exit 0
fi
git add -A
git commit -m "$MSG"
git push origin master
echo "已推送到 $REMOTE"
