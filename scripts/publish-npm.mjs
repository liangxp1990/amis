#!/usr/bin/env node
/**
 * amis 自维护分支的 npm 发布流水线。
 *
 * 作用（What）：把工作区内 6 个自研改动的包发布到自定义 scope（如 @myorg/amis）。
 * 难点是构建产物（lib/esm）里的 import/require 仍指向原始包名（amis-core 等），
 * 直接改名发布会让使用者装到百度的原包——因此发布前在"暂存目录"里完成
 * package.json 改名 + 产物内引用说明符重写，仓库源码零改动。
 *
 * 用法：
 *   SCOPE=@myorg VERSION=6.13.0 node scripts/publish-npm.mjs          # 正式发布
 *   SCOPE=@myorg VERSION=6.13.0 DRYRUN=1 node scripts/publish-npm.mjs # 演练（不 publish）
 *
 * 前置条件：
 *   1. 已在仓库根目录执行过 npm run build（产出各包 lib/ esm/）
 *   2. 已 npm login（正式发布时）
 *
 * 边界（Notes）：
 *   - amis/sdk/ 是自包含 bundle，不做引用重写；amis-theme-editor-helper /
 *     office-viewer / amis-postcss / i18n-runtime 未改动，保持外部依赖。
 *   - 发布顺序即依赖顺序：formula → core → ui → amis → editor-core → editor。
 */

import {readFile, writeFile, cp, rm, mkdir, readdir, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {execSync} from 'node:child_process';

/* ----------------------------- 配置 ----------------------------- */

const SCOPE = process.env.SCOPE; // 如 @myorg（不带斜杠结尾）
const VERSION = process.env.VERSION || '6.13.0';
const DRYRUN = process.env.DRYRUN === '1';
const ROOT = path.resolve(import.meta.dirname, '..');
const STAGING = path.join(ROOT, '.publish-staging');

if (!SCOPE || !SCOPE.startsWith('@') || SCOPE.includes('/')) {
  console.error('用法: SCOPE=@myorg VERSION=6.13.0 [DRYRUN=1] node scripts/publish-npm.mjs');
  process.exit(1);
}

/** 依赖序发布的内部包清单（最长名在前，供重写时避免子串误伤） */
const INTERNAL = [
  'amis-formula',
  'amis-core',
  'amis-ui',
  'amis',
  'amis-editor-core',
  'amis-editor'
];

/* ----------------------------- 工具函数 ----------------------------- */

/**
 * 把 import/require 说明符里的内部包名重写为 scoped 名。
 * 匹配带引号的说明符（含子路径），长名在前避免 'amis-editor' 误伤 'amis-editor-core'。
 * @param text 文件文本
 * @returns 重写后的文本
 */
function rewriteSpecifiers(text) {
  let out = text;
  for (const name of [...INTERNAL].sort((a, b) => b.length - a.length)) {
    const scoped = `${SCOPE}/${name}`;
    // 'amis-core' / "amis-core" / 'amis-core/xxx'（引号需成对）
    out = out.replaceAll(`'${name}'`, `'${scoped}'`);
    out = out.replaceAll(`"${name}"`, `"${scoped}"`);
    out = out.replaceAll(`'${name}/`, `'${scoped}/`);
    out = out.replaceAll(`"${name}/`, `"${scoped}/`);
  }
  return out;
}

/**
 * 递归处理目录下所有 js/mjs/cjs/d.ts/.map 文本的引用重写。
 * @param dir 起始目录
 */
async function rewriteTree(dir) {
  const entries = await readdir(dir, {withFileTypes: true});
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      await rewriteTree(p);
    } else if (/\.(js|mjs|cjs|d\.ts|map)$/.test(e.name)) {
      const text = await readFile(p, 'utf8');
      const next = rewriteSpecifiers(text);
      if (next !== text) {
        await writeFile(p, next);
      }
    }
  }
}

/**
 * 重写 package.json：包名、内部依赖、版本、publishConfig。
 * @param pkg 原始 package.json 对象
 * @returns 改写后的对象
 */
function rewritePackageJson(pkg) {
  const next = JSON.parse(JSON.stringify(pkg));
  next.name = `${SCOPE}/${pkg.name}`;
  next.version = VERSION;
  for (const field of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']) {
    const deps = next[field];
    if (!deps) continue;
    for (const name of INTERNAL) {
      if (deps[name] !== undefined) {
        deps[`${SCOPE}/${name}`] = deps[name];
        delete deps[name];
      }
    }
  }
  next.publishConfig = {access: 'public', ...next.publishConfig};
  // fork 标识
  next.forkOf = pkg.name;
  delete next.workspaces; // 发布体不需要
  return next;
}

/* ----------------------------- 主流程 ----------------------------- */

await rm(STAGING, {recursive: true, force: true});
await mkdir(STAGING, {recursive: true});

for (const name of INTERNAL) {
  const src = path.join(ROOT, 'packages', name);
  const pkgRaw = JSON.parse(await readFile(path.join(src, 'package.json'), 'utf8'));

  // 校验构建产物存在（revision.json 例外：官方 CI 才生成，发布时自动补）
  const files = pkgRaw.files || [];
  for (const f of files) {
    if (f === 'revision.json') continue;
    if (!existsSync(path.join(src, f))) {
      console.error(`✗ ${name} 缺少构建产物 ${f}，请先在仓库根目录执行 npm run build`);
      process.exit(1);
    }
  }

  // 复制发布文件到暂存目录
  const dest = path.join(STAGING, name);
  await mkdir(dest, {recursive: true});
  await cp(path.join(src, 'package.json'), path.join(dest, 'package.json'));
  for (const extra of ['README.md', 'LICENSE']) {
    if (existsSync(path.join(src, extra))) {
      await cp(path.join(src, extra), path.join(dest, extra));
    }
  }
  for (const f of files) {
    // revision.json 由官方 CI 生成，本地构建缺失时补一份 fork 版本信息
    if (f === 'revision.json' && !existsSync(path.join(src, f))) {
      const revision = execSync('git rev-parse HEAD').toString().trim();
      await writeFile(
        path.join(dest, f),
        JSON.stringify({revision, version: VERSION, fork: true, builtAt: new Date().toISOString()}, null, 2)
      );
      continue;
    }
    await cp(path.join(src, f), path.join(dest, f), {recursive: true});
  }

  // README 顶部加 fork 说明
  const readmePath = path.join(dest, 'README.md');
  if (existsSync(readmePath)) {
    const readme = await readFile(readmePath, 'utf8');
    await writeFile(
      readmePath,
      `> Fork of [baidu/amis](https://github.com/baidu/amis) (base 6.13.0)，自维护迭代版，发布于 \`${SCOPE}/${name}@${VERSION}\`。\n\n${readme}`
    );
  }

  // 重写 package.json
  const nextPkg = rewritePackageJson(pkgRaw);
  await writeFile(path.join(dest, 'package.json'), JSON.stringify(nextPkg, null, 2));

  // 重写产物内引用（sdk 为自包含 bundle，跳过）
  for (const f of files) {
    if (f === 'sdk') continue;
    const p = path.join(dest, f);
    if (existsSync(p) && (await stat(p)).isDirectory()) {
      await rewriteTree(p);
    } else if (/\.(js|d\.ts)$/.test(f)) {
      const text = await readFile(p, 'utf8');
      await writeFile(p, rewriteSpecifiers(text));
    }
  }

  console.log(`✓ 暂存 ${nextPkg.name}@${VERSION}（产物：${files.join(', ')}）`);
}

console.log('\n===== 发布计划（依赖序）=====');
for (const name of INTERNAL) {
  console.log(`  npm publish ${SCOPE}/${name}@${VERSION} --access public`);
}

if (DRYRUN) {
  console.log('\n[DRYRUN] 已生成暂存目录，未执行发布：%s', STAGING);
  process.exit(0);
}

// 正式发布（依赖序；显式指定官方源，避免本机镜像配置导致发布到 npmmirror）
const NPM_REGISTRY = 'https://registry.npmjs.org';
for (const name of INTERNAL) {
  const dir = path.join(STAGING, name);
  const fullName = `${SCOPE}/${name}`;
  // 幂等：目标版本已存在则跳过（支持断点续发）
  let exists = false;
  try {
    execSync(`npm view ${fullName}@${VERSION} version --registry ${NPM_REGISTRY}`, {stdio: 'pipe'});
    exists = true;
  } catch {}
  if (exists) {
    console.log(`\n>>> ${fullName}@${VERSION} 已存在，跳过`);
    continue;
  }
  console.log(`\n>>> publishing ${fullName} ...`);
  try {
    // stdio pipe：错误文本进异常对象便于判断；notice 手动回显
    const out = execSync(`npm publish --access public --registry ${NPM_REGISTRY}`, {
      cwd: dir,
      stdio: 'pipe',
      encoding: 'utf8'
    });
    console.log(String(out).trim().split('\n').slice(-4).join('\n'));
  } catch (e) {
    // registry 读写分离：读副本可能查不到刚发布的版本，但 PUT 会拒绝覆盖——视为已发布
    const err = String(e.stderr || '') + String(e.message || '');
    if (err.includes('cannot publish over the previously published version')) {
      console.log(`  ↳ ${fullName}@${VERSION} 已在 registry（读副本延迟），视为成功`);
    } else {
      console.error(err);
      throw e;
    }
  }
}
console.log('\n✅ 全部发布完成');
