---
name: amis-debug
description: 排查 amis 页面渲染/数据/交互问题时使用。触发场景：用户反馈"组件渲染不出来、数据不显示、变量取不到值、接口报错、事件动作不生效、页面空白"等运行时问题，或需要在源码中定位某个 type 的实现。
---

# amis 问题排查

依据 docs/zh-CN/extend/debug.md 与各概念文档。按症状走对应路径，先确认症状再动手。

## 第一步：开启内置调试面板

三选一（1.6.1+）：
1. render 的 env 传 `enableAMISDebug: true`
2. `window.enableAMISDebug = true`
3. 页面 URL 加 `?amisDebug=1`

右侧出现面板，提供两个能力：**运行日志**（api 请求及数据转换）、**组件数据链**（点任意组件看它的数据域链路）。

## 症状 → 排查路径

### 数据不显示 / 变量取不到值

1. **数据链**：子组件能向上找父级数据域，但父看不到子的。调试面板点组件看数据链里有没有这个变量
2. **API 返回格式**：必须是 `{status: 0, msg: '', data: {...}}`，status 非 0 一律按失败处理，数据只取 `data` 字段 —— 这是最高频原因
3. **模板语法**：`${xxx}` 是模板（amis-formula 求值）；条件类属性（visibleOn/hiddenOn/disabledOn）是**表达式**，不写 `${}` 包裹整个（详见 docs/zh-CN/concepts/expression.md）
4. **数据映射**：api 的 `data: {a: '${b}'}` 是发送前的映射，别和响应弄混

### 组件渲染不出来

1. 控制台报错优先
2. `type` 拼写（kebab-case）；宿主项目里还要确认对应渲染器模块被 import 过（`packages/amis/src/index.tsx` 里没 import 的就是没有）
3. 本仓库内可用 `getRenderers()`（amis-core 导出）查注册表
4. 定位实现源码：`packages/amis/src/renderers/` 下按文件名找（表单控件在 Form/ 子目录），或 `grep -rn "type: 'xxx'" packages/amis/src/renderers/`
5. 数据流看 `packages/amis-core/src/store/` 对应 store（form/formItem/crud/service...）

### 接口请求失败

1. amis 自身不发请求，全走宿主传入的 `env.fetcher` —— 宿主没实现 fetcher 一切 api 配置都无效
2. 编辑器预览跨域：用 Editor 的 `schemaFilter` 做 api proxy
3. 运行日志（调试面板）里看请求与响应转换

### 事件动作不生效

1. `onEvent` 需要 1.7.0+；动作配置结构：`onEvent.{事件名}.actions[].actionType/args`
2. 动作实现在 `packages/amis-core/src/actions/`，按 actionType 找源码（如 toast、ajax、setValue、custom）
3. 目标组件动作（componentId）要求目标配置了 `id`；广播（broadcast）排查事件名是否一致
4. 事件表在组件文档底部（docs/zh-CN/components/xxx.md）

### 样式/主题异常

- 类名必须 `cx('Xxx')` 大写开头 + scss 里 `#{$ns}Xxx`，缺一边就丢样式
- 主题：cxd（默认）/antd/ang/dark，样式文件在 packages/amis/scss/themes/

## 高效复现：写最小单测

比启动 dev server 快得多：

```tsx
// packages/amis/__tests__/renderers/MyCase.test.tsx
import {render as amisRender} from '../../src/index';
import React from 'react';
import {render} from '@testing-library/react';

test('case', () => {
  const {container} = render(amisRender({
    type: 'page',
    body: {type: 'my-widget', src: 'x.png'}
  }));
  // 断言或 console.log(container.innerHTML)
});

// 运行：./node_modules/.bin/jest packages/amis/__tests__/renderers/MyCase.test.tsx
```

## 明确已知陷阱

- 报错 `pdfjsWorkerSrc is required`：**先确认宿主安装的 amis 版本再给方案**（API 换过三代，最新文档≠旧版本行为）：
  - amis ≤ 6.4.x：无需配置（worker 打进产物）
  - amis 6.5.0~6.7.x：在 `render(schema, props, env)` 的 **env 参数**里传 `pdfjsWorkerSrc`（报错文案带 "in env" 即此版本段；此段 `setGlobalOptions` 尚不存在，import 会构建报错 "was not found in 'amis-core'"）
  - amis ≥ 6.8.0（2024-09 起）：`setGlobalOptions({pdfjsWorkerSrc})`（amis-core 导出，factory.tsx），env 里的该字段已删除
  - worker 地址版本须匹配 amis-ui 内置的 react-pdf/pdfjs-dist（6.5~6.8 均为 4.3.136）
- 宿主项目报 `export 'xxx' was not found in 'amis-core'`：说明用了比宿主安装版本新的 API，用报错里打印的 possible exports 清单核对，再 `git log -S "xxx" --oneline` 查该 API 引入时间/对应版本
- README 提示 jest 前需先 `npm run build`；根 jest 配置实际用 @swc/jest 映射 src，若失败再考虑 build
- Node 版本：推荐 12/14/16，npm 7+（workspaces）
