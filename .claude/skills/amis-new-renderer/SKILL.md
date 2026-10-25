---
name: amis-new-renderer
description: 在 amis 仓库新增渲染器组件（普通渲染器/表单项/选项组件）时使用。触发场景：用户要求"新增组件/新增渲染器/加一个 xxx 组件/让 schema 支持 xxx 类型/给 amis 贡献组件"。覆盖装饰器选择、Schema 类型登记、异步注册、样式、文档、测试的完整链路。
---

# 新增 amis 渲染器组件

依据 docs/zh-CN/extend/contribute.md（avatar 实战）与 docs/zh-CN/extend/custom-react.md。核心原则：**先看 renderers/ 里最像的现有组件抄结构，不要从零发明**（常见组件走读见 references/component-walkthrough.md）。

## 0. 路径速查（v6 重构后的真实位置，旧博客/旧文档很多是错的）

| 内容 | 真实位置 |
|---|---|
| `@Renderer` 装饰器 | packages/amis-core/src/factory.tsx |
| `@FormItem` 装饰器 | packages/amis-core/src/renderers/Item.tsx（**不在 amis 包**） |
| `@OptionsControl` 装饰器 | packages/amis-core/src/renderers/Options.tsx |
| 渲染器实现 | packages/amis/src/renderers/（表单控件在 Form/ 子目录） |
| Schema 类型登记 | packages/amis/src/SchemaFull.ts（模块增强 `AMISSchemaRegistry`） |
| 渲染器注册 | packages/amis/src/minimal.ts（`registerRenderer` + `getComponent` 异步 import） |
| 组件样式 | packages/amis-ui/scss/components/（**amis 包没有 scss 目录**，css 产物从 amis-ui 复制） |

## 第一步：三个决策

### 1. 组件放哪个包？

```
会被其他 amis-ui 组件复用、纯 UI 无渲染引擎依赖？
  → packages/amis-ui/src/components/Xxx.tsx（不注册渲染器）
  → packages/amis/src/renderers/Xxx.tsx 里做一层注册壳
否则直接在 packages/amis/src/renderers/Xxx.tsx 实现全部
```

表单控件类通常在 amis-ui 放基础组件（如 Input、Select），renderers/Form/ 下放注册壳。非表单的简单展示组件直接放 renderers/。

### 2. 用哪个注册装饰器？

| 装饰器 | 场景 | 自动获得的能力 |
|---|---|---|
| `@Renderer({type})` | 通用渲染器 | render()/env/data/dispatchEvent 等 RendererProps |
| `@FormItem({type})` | 表单项 | label/描述/验证/三种布局，只需实现 value + onChange |
| `@OptionsControl({type})` | 选项类（类似 Select/Checkboxes） | options、source 动态拉取、selectedOptions、onToggle/onToggleAll |

三个装饰器注入的完整 props 清单与内部机制见 **references/renderer-mechanisms.md**。

### 3. type 命名

kebab-case，如 `my-widget`。同 type 重复注册且未设 `override: true` 会直接抛错；一个组件支持多个 type 用 `alias`（如 Action：`type: 'action', alias: ['button', 'submit', 'reset']`）。

## 第二步：写渲染器（模板）

### 普通渲染器（imports 照抄 Alert.tsx 的真实写法）

```tsx
// packages/amis/src/renderers/MyWidget.tsx
import React from 'react';
import {
  Renderer,
  RendererProps,
  AMISSchemaBase
} from 'amis-core';

/** Schema 类型：注释会被 build-schemas 生成到 schema.json，供编辑器提示 */
export interface AMISMyWidgetSchema extends AMISSchemaBase {
  type: 'my-widget';
  /** 属性都写清注释 */
  src?: string;
}

export interface MyWidgetProps extends RendererProps {
  src?: string;
}

@Renderer({type: 'my-widget'})
export class MyWidgetRenderer extends React.Component<MyWidgetProps> {
  render() {
    const {className, src, classnames: cx} = this.props;
    // 类名必须走 cx 且大写开头（SUIT 规范），才能配合 $ns 生成 .cxd-MyWidget
    return (
      <div className={cx('MyWidget', className)}>
        <img src={src} />
      </div>
    );
  }
}

/** 渲染子节点用 render(region, node)：容器组件必用（真实例子见 Flex/Card 走读） */
// const {render, body} = this.props; ... {render('body', body)}
```

### 表单项（只关心 value/onChange）

```tsx
import React from 'react';
import {FormItem, RendererProps} from 'amis-core';

export interface MyInputProps extends RendererProps {
  value?: any;
}

@FormItem({
  type: 'my-input'
  // strictMode: false  // 默认仅 detectProps 白名单属性变化才重渲染；白名单外的 props 变化不更新时才关
})
export default class MyInputRenderer extends React.Component<MyInputProps> {
  render() {
    const {value, onChange, data, onBulkChange} = this.props;
    // value=当前 name 对应的值；onChange 改值；data=整个作用域数据；onBulkChange 批量设值
    return (
      <input value={value || ''} onChange={e => onChange(e.target.value)} />
    );
  }
}
```

### 统一事件范式（自定义事件必须遵守，否则 onEvent 配置不生效）

```tsx
import {resolveEventData} from 'amis-core';

@autobind
async handleChange(option: any) {
  const {onChange, dispatchEvent} = this.props;
  const rendererEvent = await dispatchEvent(
    'change',
    resolveEventData(this.props, {value: option})  // 组装事件数据，自动合并 data 作用域
  );
  if (rendererEvent?.prevented) return;  // 用户动作链 preventDefault 后中止默认行为
  onChange && onChange(option);          // 先 dispatch 再 onChange，全仓库统一范式
}
```

事件机制细节（事件对象、weight、广播）见 references/renderer-mechanisms.md。

## 第三步：注册与样式（缺一不可，组件才能渲染）

1. **Schema 类型登记**：`packages/amis/src/SchemaFull.ts` 的 `declare module 'amis-core' { interface AMISSchemaRegistry { ... } }` 块里加：

```ts
'my-widget': AMISMyWidgetSchema;  // 顶部同步 import 该类型
```

（`packages/amis/src/Schema.ts` 里 `SchemaType = AMISSchemaType` 只是别名转发，别改它）

2. **渲染器注册**：`packages/amis/src/minimal.ts` 加异步注册（懒加载，控制首屏体积）：

```ts
registerRenderer({
  type: 'my-widget',
  getComponent: () => import('./renderers/MyWidget')
});
```

3. **样式**：新建 `packages/amis-ui/scss/components/_my-widget.scss`：

```scss
.#{$ns}MyWidget {
  // #{$ns} 是主题前缀，cxd 主题下生成 .cxd-MyWidget
  color: var(--text-color);  // 优先用已有 CSS 变量
}
```

4. `packages/amis-ui/scss/themes/_common.scss` 里加 `@import '../components/my-widget';`
5. 需要新 CSS 变量时加到 `scss/_properties.scss`（语义层）或 `_components.scss`（组件层），**不要在组件 scss 里用 `@if/lighten/darken`**（无法转成 CSS 变量，见 amis-ui/scss/README.md）

## 第四步：文档（文档即示例）

新建 `docs/zh-CN/components/my-widget.md` 并注册到 examples/components/Components.tsx。` ```schema ` 代码块会被文档站实时渲染成可交互示例。完整规范用 **amis-docs** skill。

## 第五步：测试

`packages/amis/__tests__/renderers/MyWidget.test.tsx`，模板与 makeEnv/wait 用法见 **amis-testing** skill。

## 高级特性（按需，详见 references/renderer-mechanisms.md）

- **异步验证**：组件类实现 `validate()` 方法，可返回 Promise
- **组件间通信**：`static contextType = ScopedContext`，constructor 里 `scoped.registerComponent(this)`，卸载时 unRegister；外部按 schema 的 `name`/`id` 经 `getComponentByName` 找到组件
- **自带数据域**：`@Renderer({type, storeType: 'xxxStore', isolateScope: true})`，store 定义在 amis-core/src/store/（参考 service/crud）
- **属性自动支持 `${}` 变量**：config 加 `autoVar: true`
- **替换系统渲染器**：同 type 重新注册需 `override: true`
- **编辑器支持**：继续用 amis-new-editor-plugin skill 加编辑器插件

## 实战铁律（captcha 组件开发实证，违反必踩坑）

1. **env.fetcher 必须传原始 api 配置**：fetcher 已被 factory 的 wrapFetcher 包装（内部二次 buildApi）。提前 `buildApi(api, params)` 会把参数固化进 `api.data`，第二参数的动态字段（token/body 等）**全部被丢弃**。正确：`env.fetcher(apiConfig字符串或对象, createObject(data, {全部动态字段}))`。
2. **表单项 Props 类型 `extends FormControlProps`**（amis-core 导出）：不要自己拼 `RendererProps + Schema`——Schema 链上 `AMISClassName` 类型的属性会触发 @FormItem 装饰器 TS1238（逐个 Omit 是打地鼠）；也不要把继承来的 `onChange` 重声明为可选（TS2430）。交集键用 `Omit<AMISXxxSchema, 'type' | 'className' | keyof FormControlProps>` 消除。
3. **Schema 属性命名避让**：`mode` 是表单布局属性（horizontal/inline/normal），组件自己的"形态"类属性必须换名（如 `displayMode`），否则类型不兼容。
4. **组件动作**：组件实现 `doAction(action, data, throwErrors)` 分发自定义动作（如 open/refresh/clear/reset）；动作链调用写法是 `{"actionType": "<动作名>", "componentId": "xxx"}`——**不是** `{actionType:'component', args:{action:'xxx'}}`（v6 无 args.action 处理，永不进目标分支）。编辑器插件 actions 数组同步登记才出现在动作面板。
5. **H5 自适应模式**：交互型图形控件用 `width + maxWidth:'100%' + aspectRatio` 替代固定高度；坐标/几何换算一律按渲染时 `offsetWidth/offsetHeight` 动态计算（jsdom 里恒为 0，测试需 `Object.defineProperty` mock），任意显示尺寸下数学自洽。触摸交互用 pointer 事件（`touch-action:none` 防滚动劫持）+ mouse 事件兜底（双绑定需防重复：会话存在即 return）。

## 深入阅读（references/）

- **references/renderer-mechanisms.md**：三个装饰器注入 props 全清单、注册/查找/weight 机制、事件系统、Scoped 数据域、themeable
- **references/component-walkthrough.md**：Alert（最简展示）/ Action（交互+alias 多注册）/ InputText（表单壳+五类事件）/ Radios（OptionsControl 范本）/ Flex（容器 render 模式）真实源码走读

## 完成检查清单

- [ ] renderers/Xxx.tsx（含 AMISXxxSchema + @Renderer/@FormItem/@OptionsControl，事件走 dispatch→prevented→onChange 范式）
- [ ] SchemaFull.ts 的 AMISSchemaRegistry 已登记
- [ ] minimal.ts 已 registerRenderer（异步 getComponent）
- [ ] amis-ui/scss/components/_xxx.scss 已建且 themes/_common.scss 已引入
- [ ] docs/zh-CN/components/xxx.md + Components.tsx 已加
- [ ] 测试用例已写且通过
- [ ] 文档站本地验证：npm start 后访问组件文档页
