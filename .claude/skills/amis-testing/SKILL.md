---
name: amis-testing
description: 编写或运行 amis 的 Jest 单元测试时使用。触发场景：用户要求"写测试/单测/加用例/跑测试/mock 接口/更新 snapshot"，或需要了解 makeEnv、wait 等测试工具的用法。
---

# amis 测试编写与运行

## 运行命令

```bash
./node_modules/.bin/jest packages/amis/__tests__/renderers/Form/buttonToolBar.test.tsx   # 单文件
./node_modules/.bin/jest <文件> -t 'Renderer:button-toolbar'                            # 单文件内某用例
npm test --workspace amis -- -t <spec-name>                                             # 按用例名
npm run update-snapshot [--workspace amis -- -t <spec-name>]                            # 更新快照
npm run coverage
```

README 提示 `npm test --workspaces` 前需先 `npm run build`；根 jest 配置实际用 @swc/jest 并把 amis-* 映射到 src，直接跑单文件通常可行，失败再 build。

## 测试文件位置

- `packages/amis/__tests__/renderers/Xxx.test.tsx` — 渲染器测试（表单控件在 `renderers/Form/` 子目录，表格在 `Table/`）
- `packages/amis/__tests__/stores/` — store 测试
- `packages/amis/__tests__/event-action/` — 事件动作测试
- 其余包（amis-core、amis-formula、amis-ui）测试在各包 `__tests__/` 或 src 内 `*.test.ts(x)`
- jest 配置在根 package.json（jsdom 环境、testRegex `/.*\.test\.(ts|tsx|js)$/`）

## 标准模板（仓库现行模式，照此写）

```tsx
/**
 * 组件名称：My-Widget 某组件
 * 单测内容：
 * 1. 基础使用
 * 2. xxx 场景
 */
import {render, cleanup, fireEvent} from '@testing-library/react';
import '../../../src';  // 引入全部渲染器注册（路径按文件层级）
import {render as amisRender} from '../../../src';
import {makeEnv, wait} from '../../helper';
import {clearStoresCache} from '../../../src';

afterEach(() => {
  cleanup();
  clearStoresCache();  // store 是全局缓存的，必须清理避免用例间串扰
});

test('Renderer:my-widget', async () => {
  const {container, getByText} = render(
    amisRender(
      {
        type: 'page',
        body: {type: 'my-widget', src: 'x.png'}
      },
      {},                    // props
      makeEnv({})            // env
    )
  );

  expect(container.querySelector('.cxd-MyWidget')).toBeInTheDocument();
});
```

## 测试工具（packages/amis/__tests__/helper.tsx）

- `makeEnv(partial)`：构造最小 env（已内置 session/isCancel/notify/jumpTo/alert），覆盖传入即可。**mock 接口就传 fetcher**：

```tsx
makeEnv({
  fetcher: async ({url, method, data}) => ({
    ok: true,
    status: 200,
    data: {status: 0, data: {items: [], total: 0}}  // 注意两层 data，符合 API 协议
  })
})
```

- `wait(duration, fn?)`：默认用 @testing-library 的 waitFor 轮询（duration+100ms 超时），比裸 sleep 稳
- `createMockMediaMatcher(matches)`：mock matchMedia（测响应式时用）

## 写用例要点

1. **交互用 fireEvent**：`fireEvent.click(getByText('提交'))`，之后异步断言用 `await wait(...)`
2. **断言优先查类名**：`container.querySelector('.cxd-Xxx')`（主题前缀 cxd 为默认主题）；快照断言 `expect(container).toMatchSnapshot()` 谨慎用，渲染器输出大、diff 噪音多
3. **异步组件**（Dialog/懒加载）：`await wait(...)` 或 `findByText`，别用固定 setTimeout
4. **表单提交链路**：mock fetcher 断言请求体；触发失败场景返回 `data: {status: 500, msg: 'x'}`
5. **name 取值**：给 page/form 组件都配 name 后 `amisRender(...)` 返回的 scoped 可 `getComponentByName`，但单测里更常用的是从 store 断言
6. 新用例先跑一遍看输出再补断言：`./node_modules/.bin/jest <文件> 2>&1 | head -50`

## jsdom 五坑（captcha 组件开发实证，逐一踩过）

1. **fetcher mock 是单 config 参数**：`makeEnv({fetcher})` 传入的函数被 factory 的 wrapFetcher 包装，mock 收到 `(config)` 而非 `(config, data)`——**POST 请求体在 `config.data`**。`url` 取法要兼容字符串：`const url = typeof config === 'string' ? config : config?.url || ''`。
2. **waitFor 必须等数据依赖的 DOM 状态**：fetcher 被调用 ≠ 响应已 setState（中间隔 wrapFetcher→adaptor 多个异步 hop）；静态文案（如提示语）首帧就存在，等它等于没等。等"只有数据到位才会出现的信号"：img src 含真实 base64、wordList 渲染出的字符、error 元素出现等。无 DOM 信号时 `waitFor(fetcher 计数) + await wait(300)` 兜底。
3. **无 TextEncoder 全局**：jsdom 不提供，组件代码别用（用 `unescape(encodeURIComponent(str))` 实现 UTF-8 编码，顺带兼容老浏览器）。
4. **拖动类交互用 mouse 事件**：`fireEvent.pointerMove/Up` 在 jsdom 不可靠（PointerEvent 构造缺失），用 `fireEvent.mouseDown(handle, {clientX})` + `fireEvent.mouseMove(document, ...)` + `fireEvent.mouseUp(document)`。
5. **offsetWidth/offsetHeight 恒为 0**：布局不计算，涉及几何的组件必须 mock：`Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {configurable: true, get: () => 310})`（组件按实际值换算时测试才可预测）。
