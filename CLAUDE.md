# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

amis 是前端低代码框架：通过 JSON 配置（Schema）生成完整页面。npm workspaces + lerna 管理的 monorepo。文档源在 `docs/zh-CN/`，扩展开发文档在 `docs/zh-CN/extend/`，核心概念在 `docs/zh-CN/concepts/`。

## 常用命令

```bash
npm i --legacy-peer-deps   # 安装依赖（Node 12/14/16，npm 7+）
npm start                  # vite 开发服务，http://127.0.0.1:8888；编辑器开发访问 /packages/amis-editor/
npm run build              # 构建所有包（rollup，产出 lib/ 与 esm/）
npm run build-esm
npm run typecheck          # tsc --noEmit（tsconfig.typecheck.json）
npm run stylelint          # 检查 scss
```

### 测试

README 声明：jest 不直接支持 TypeScript，跑 `npm test --workspaces` 前需先 `npm run build`。（根 package.json 的 jest 配置用 @swc/jest 并把 amis-* 映射到各包 src）

```bash
npm test --workspaces                                  # 全部测试
npm test --workspace amis -- -t <spec-name>            # 按用例名过滤，如 inputImage
./node_modules/.bin/jest packages/amis/__tests__/renderers/Form/buttonToolBar.test.tsx          # 单文件
./node_modules/.bin/jest packages/amis/__tests__/renderers/Form/buttonToolBar.test.tsx -t 'Renderer:button-toolbar'  # 单文件内某个用例
npm run update-snapshot [--workspace amis -- -t <spec-name>]
npm run coverage
```

测试文件位置：packages/amis/__tests__/（renderers/stores/utils）及各包 src 内的 *.test.ts(x)。写个最小 .test.tsx 复现问题，通常比启动 dev server 更快。

## 架构

### 包依赖链

```
amis-formula → amis-core → amis-ui → amis → amis-editor-core → amis-editor
office-viewer（独立，被 amis 动态引入）
```

- **amis-formula**：公式引擎（lexer/parser/evalutor/filter），`${xxx}` 模板与表达式的求值都在这
- **amis-core**：渲染引擎与运行时（不依赖具体组件）
- **amis-ui**：与 JSON 渲染无关的纯 React 组件库（components/）；主题在 themes/（cxd 默认、antd、ang、dark）
- **amis**：所有渲染器（src/renderers/，Form/Table/CRUD 等按目录分组）及 Schema TS 类型
- **amis-editor-core / amis-editor**：可视化编辑器内核；各组件的编辑面板插件在 packages/amis-editor/src/plugin/

### amis-core/src 关键文件（渲染主链路）

- `factory.tsx`：渲染总入口，对外暴露 `render` 方法；维护渲染器注册表（`getRenderers()` 可查）
- `SchemaRenderer.tsx`：组件渲染的主要入口
- `Root.tsx` / `RootRenderer.tsx`：最外层渲染组件
- `Scoped.tsx`：**数据域**的实现，amis 最重要的概念之一
- `WithStore.tsx` / `WithRootStore.tsx`：store 注入（mobx-state-tree）
- `env.tsx`：默认 env；fetcher 等由宿主应用通过 env 传入
- `store/`：MST store（root、form、formItem、crud、combo、table、service 等，渲染器配置 `storeType` 关联）
- `renderers/Item.tsx`：@FormItem 装饰器（表单项 props 注入/校验/strictMode）；`renderers/Options.tsx`：@OptionsControl（options 解析/selectedOptions/onToggle）
- `theme.tsx`：主题注册表（theme()/getTheme()/themeable，渲染时由 env.theme 指定）
- `utils/renderer-event.ts`：dispatchEvent/onEvent 动作链的事件对象与分发实现

### 工作原理（docs/zh-CN/extend/internal.md）

JSON 节点按 `type` 字段从组件池找到对应 React Component，其余属性作为 props 下发。容器组件不直接渲染子节点，而是调用 props 里的 `render(region, node)` 方法（region 是区域名，同一组件多区域不能重名）。

### 数据域与数据链（docs/zh-CN/concepts/datascope-and-datachain.md）

- 组件初始化时（如 `initApi`）把接口返回的 `data` 存入当前数据域；模板 `${xxx}` 从当前数据域取值
- 数据链：子组件可向上查找父级数据域的变量（如 form 里的控件能看到 page 的数据）；`name` 落在数据域中成为变量
- 相关：数据映射 `data: {xxx: '${yyy}'}`（docs/zh-CN/concepts/data-mapping.md）

### API 协议（docs/zh-CN/types/api.md）

所有接口返回必须符合：`{status: 0, msg: '', data: {...}}`，status 非 0 按错误处理。排查"数据不显示"先看接口返回格式。

### env 适配层（docs/zh-CN/start/getting-started.md）

`render(schema, props, env)` 的 env 是宿主必须适配的接口：`fetcher`（必须）、`notify`、`alert`、`confirm`、`jumpTo`、`updateLocation` 等。amis 自身不发请求，全走 env.fetcher。全局配置（如 pdfjsWorkerSrc）用 `setGlobalOptions`（factory.tsx），不在 env 里。

### 事件动作（docs/zh-CN/concepts/event-action.md）

1.7.0+ 的核心交互机制：`onEvent: {事件名: {actions: [{actionType, args}]}}`，动作实现在 amis-core/src/actions/。优先用事件动作而非旧联动写法。

### 主题与样式约定

- CSS 类名用 SUIT 规范，组件内用 `cx('Xxx')` 生成（大写开头），配合 `#{$ns}` 前缀实现多主题（cxd 下生成 `.cxd-Xxx`）
- scss 全在 packages/amis-ui/scss/（amis 包只有构建时复制的 css 产物）：组件样式 components/_xxx.scss（表单类在 form/ 子目录），在 themes/_common.scss 引入
- CSS 变量三层：主题 token（themes/_cxd-variables.scss 等，`--colors-brand-5` 这类）→ 语义变量（_properties.scss，`--primary/--text-color/--borderColor` 等）→ 组件变量（_components.scss）；组件 scss 禁用 @if/lighten/darken（无法转成 CSS 变量，见 amis-ui/scss/README.md）

## 新增渲染器组件的标准流程

完整链路（见 docs/zh-CN/extend/contribute.md 实战，或用 `/amis-new-renderer` skill）：

1. `packages/amis/src/renderers/Xxx.tsx`：组件 + `AMISXxxSchema` 接口 + `@Renderer({type})` 装饰器
2. `packages/amis/src/SchemaFull.ts`：在 `declare module 'amis-core'` 的 `AMISSchemaRegistry` 模块增强中登记 `'xxx': AMISXxxSchema`（Schema.ts 只是 `SchemaType = AMISSchemaType` 别名转发）
3. `packages/amis/src/minimal.ts`：`registerRenderer({type: 'xxx', getComponent: () => import('./renderers/Xxx')})` 异步注册（index.tsx 只 import './minimal'）
4. scss 样式（见上节约定，在 amis-ui/scss）
5. 文档 `docs/zh-CN/components/xxx.md`（` ```schema ` 代码块会被文档站实时渲染为可交互示例）+ examples/components/Components.tsx 引用
6. 测试 packages/amis/__tests__/renderers/
7. 如需可视化编辑器支持：packages/amis-editor/src/plugin/ 加插件（`/amis-new-editor-plugin` skill）

表单项用 `@FormItem`（自动处理 label/验证/三种布局，只需关心 value/onChange）；选项类组件用 `@OptionsControl`（自动处理 options/source/selectedOptions/onToggle）。注册装饰器差异详见 docs/zh-CN/extend/custom-react.md。

## 调试（docs/zh-CN/extend/debug.md）

开启内置调试面板（右侧，含运行日志和组件数据链查看）三选一：
1. env 里设 `enableAMISDebug: true`
2. `window.enableAMISDebug = true`
3. URL 加 `?amisDebug=1`

排查运行时问题（数据不显示/组件不渲染/事件不生效等）用 `/amis-debug` skill。

## 项目定制 skills（.claude/skills/）

按任务选：**使用 amis**（写 JSON 配置）→ `amis-schema`；**开发 amis**（改源码）→ 组件开发 `amis-new-renderer`、主题定制 `amis-custom-theme`、测试 `amis-testing`、文档 `amis-docs`；**编辑器** → 插件开发 `amis-new-editor-plugin`、宿主接入 `amis-editor-usage`；**排查问题** → `amis-debug`。

## 约定

- 用 TypeScript 编写（README 明确要求）；prettier + stylelint 经 lint-staged 在 pre-commit 自动执行
- eslint 9 flat config（eslint.config.mjs）
- 多语言文件在各包 src/locale/；编辑器相关包用 `npm run i18n:update`（根 i18nConfig.ts）维护
- 分支开发：feat-xxx 分支 → PR 合入 master
