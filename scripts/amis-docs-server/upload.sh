#!/bin/bash
#
# 同步文档站与 mock 服务到 103.90.155.117 并重启容器
#
# 作用：① rsync gh-pages 产物与 mock 服务到 /data/traefik-routes/amis/
#       ② 远程 docker compose up -d（traefik 热加载自动生效）
# 前置：本地已执行 IS_AISUDA=1 sh deploy-gh-pages.sh（产出 gh-pages/）
# 参数：无（远程账号/路径用环境变量 REMOTE / REMOTE_DIR 可覆盖）
# 返回：退出码 0 表示部署完成
# 异常：ssh 不可达 / /data/traefik-routes 无写权限（需 root 或 docker 容器绕过，
#       见 OpenViking 记忆 server/103.90.155.117 的踩坑方案）时退出非 0
set -e
cd "$(dirname "$0")/../.."

REMOTE="${REMOTE:-sshuser@103.90.155.117}"
REMOTE_DIR="${REMOTE_DIR:-/data/traefik-routes/amis}"

# mock-server 目录 = 部署框架 + 仓库 mock/（首次部署在本机装好 express 依赖一并上传）
if [ ! -d scripts/amis-docs-server/mock-server/node_modules ]; then
  npm i --prefix scripts/amis-docs-server/mock-server --omit=dev
fi

ssh "$REMOTE" "mkdir -p $REMOTE_DIR/mock-server $REMOTE_DIR/site/amis"
rsync -a --delete scripts/amis-docs-server/mock-server/ "$REMOTE:$REMOTE_DIR/mock-server/"
# mock 的 index.js + cfc 放进 mock-server/mock/（server.mjs 按相对路径加载）
rsync -a mock/index.js mock/cfc "$REMOTE:$REMOTE_DIR/mock-server/mock/"
rsync -a --delete --exclude .git gh-pages/ "$REMOTE:$REMOTE_DIR/site/amis/"
rsync -a scripts/amis-docs-server/docker-compose.yml scripts/amis-docs-server/default.conf "$REMOTE:$REMOTE_DIR/"

ssh "$REMOTE" "cd $REMOTE_DIR && docker compose up -d --remove-orphans"
echo "✓ 部署完成：https://amis.elstgl.com/amis/"
