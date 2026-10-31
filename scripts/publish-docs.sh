#!/bin/bash
#
# 发布定制文档站到 GitHub Pages（liangxp1990/amis 的 gh-pages 分支）
#
# 作用：在 deploy-gh-pages.sh 产出的 gh-pages/ 目录上补 GitHub Pages 必需的
#       SPA 404 fallback（404.html + index.html 路径恢复脚本），并以孤儿提交
#       强推到 fork 的 gh-pages 分支。幂等：重复执行注入不会重复叠加。
# 参数：无（环境变量 GITHUB_REMOTE / GH_PAGES_BRANCH 可覆盖默认值）
# 返回：退出码 0 表示推送成功
# 异常：gh-pages/ 目录不存在（未先执行 deploy-gh-pages.sh）或 ssh 推送失败时退出非 0
#
# 完整发布流程（须 Node 20，与 CI 一致）：
#   export PATH=~/.nvm/versions/node/v20.19.1/bin:$PATH
#   npm run build --workspaces && sh deploy-gh-pages.sh && sh scripts/publish-docs.sh
#
# ⚠️ 请勿启用 fork 仓库的 gh-pages workflow：它会用 master（无定制内容）
#    自动构建并覆盖本脚本推送的产物。

set -e
cd "$(dirname "$0")/.."

GITHUB_REMOTE="${GITHUB_REMOTE:-ssh://git@ssh.github.com:443/liangxp1990/amis.git}"
GH_PAGES_BRANCH="${GH_PAGES_BRANCH:-gh-pages}"

[ -f gh-pages/index.html ] || { echo "错误：gh-pages/ 不存在，请先执行 sh deploy-gh-pages.sh"; exit 1; }

# --- 1. 404 页：记录原始路径后跳回首页（GitHub Pages 无 SPA fallback 的替代方案） ---
if [ ! -f gh-pages/404.html ]; then
cat > gh-pages/404.html <<'HTMLEOF'
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <script>
      (function () {
        try {
          var p = location.pathname + location.search + location.hash;
          if (p.indexOf('/amis/') === 0 && p !== '/amis/') {
            sessionStorage.setItem('amis-docs:redirect', p);
          }
        } catch (e) {}
        location.replace('/amis/');
      })();
    </script>
  </head>
  <body></body>
</html>
HTMLEOF
fi

# --- 2. index.html：注入路径恢复脚本（应用路由初始化前执行；幂等） ---
if ! grep -q 'amis-docs:redirect' gh-pages/index.html; then
  python3 - <<'PYEOF'
import re
path = 'gh-pages/index.html'
html = open(path, encoding='utf-8').read()
snippet = """<script>
      /* GitHub Pages SPA fallback：恢复 404.html 记录的原始路径（须在应用路由初始化前执行） */
      (function () {
        try {
          var p = sessionStorage.getItem('amis-docs:redirect');
          if (p && p.indexOf('/amis/') === 0) {
            sessionStorage.removeItem('amis-docs:redirect');
            history.replaceState(null, '', p);
          }
        } catch (e) {}
      })();
    </script>
    """
html = html.replace('<head>', '<head>\n    ' + snippet.rstrip(), 1)
open(path, 'w', encoding='utf-8').write(html)
print('index.html 注入完成')
PYEOF
fi

# --- 3. 孤儿提交并强推 ---
cd gh-pages
git init -q -b gh-pages-build
git add -A
git -c user.name="liangxianping" -c user.email="liangxp1990@users.noreply.github.com" \
  commit -q -m "docs: 定制 amis 文档站静态产物（SPA 404 fallback）" || true
git push -f "$GITHUB_REMOTE" HEAD:"$GH_PAGES_BRANCH"
echo "✓ 已推送：https://liangxp1990.github.io/amis/"
