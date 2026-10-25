# 渲染器机制源码详解（amis-core）

写组件遇到"为什么这个 prop 没生效 / 为什么不重渲染 / 怎么触发事件"时查本文件。行号基于 master（v6.x），以文件内容为准。

## 1. @Renderer：注册与查找（packages/amis-core/src/factory.tsx）

### RendererBasicConfig 全字段（factory.tsx:47-76）

| 字段 | 作用 |
|---|---|
| `type` | 注册类型（kebab-case），与 `test` 二选一必填 |
| `test` | 正则/函数匹配，`resolveRenderer` 兜底遍历用 |
| `alias` | 别名数组，一次注册命中多个 type（如 action 的 button/submit/reset） |
| `weight` | 权重，**越小越优先命中**（默认 0）；按 test 匹配时有意义 |
| `storeType` | 关联 MST store（amis-core/src/store/ 下定义），自动包 `HocStoreFactory(observer(component))` |
| `storeExtendsData` | store 是否继承上层数据域（service 设 false） |
| `isolateScope` | 自动包 `Scoped(component, type)`，创建独立数据域（form/crud 都开了） |
| `autoVar` | 属性值自动解析 `${}` 变量 |
| `override` | 覆盖系统渲染器时必须 true，否则同 type 重复注册直接抛错 |
| `defaultProps` | 函数，按 type/schema 返回默认 props |
| `isFormItem` | FormItem 内部标记，普通渲染器不用管 |
| `name` / `origin` / `shouldSyncSuperStore` / `onGlobalVarChanged` | 少用：注册名、原配置引用、父 store 同步策略、全局变量变化回调 |

### 注册机制（factory.tsx:229-319）

- `type` 转小写，`type + alias` 拼出匹配正则；写入 `renderersTypeMap[type]`（精确命中 O(1)）与 `renderersMap[name]`。
- 查找链 `resolveRenderer`（:631-679）：先 `renderersTypeMap[type]`，miss 才按 `test` 遍历（此时 weight 生效）。
- 异步注册：`registerRenderer({type, getComponent: () => import(...)})`，命中时 `loadAsyncRenderer` 动态加载（factory.tsx:359-411）。**amis 内置渲染器全部走这条（见 packages/amis/src/minimal.ts）**。

### RendererProps 关键成员（factory.tsx:78-111）

```ts
render(region, node, props?)   // 渲染子区域（region 名同组件内唯一）
env                            // fetcher/notify/alert/confirm/jumpTo... 宿主适配层
$path / $schema                // 当前层级路径 / 原始 schema 节点
data                           // 当前数据域快照
dispatchEvent(e, data?, renderer?, scoped?)  // 触发 onEvent 动作链（见 §4）
store / syncSuperStore / onBroadcast / mobileUI / testIdBuilder
// 另继承 ThemeProps: classnames(cx)/classPrefix/theme
// 另继承 OnEventProps: onEvent
```

## 2. @FormItem（packages/amis-core/src/renderers/Item.tsx，2438 行）

注册（:2412-2431）：`FormItem(config)` → `asFormItem(config)(component)` 包裹 → `registerRenderer({..., weight: -100, isFormItem: true})`（比普通渲染器优先级高，保证表单控件先命中）。

### 注入给内层组件的 props（FormItemProps，Item.tsx:542-599）

| prop | 说明 |
|---|---|
| `value` / `defaultValue` | 当前 name 对应的值（value 注释明确：defaultValue 只能静态值，取变量靠 name） |
| `onChange(value, submitOnChange?, changeImmediately?)` | 改值 |
| `onBulkChange(values)` | 一次改多个字段 |
| `setPrinstineValue(value)` | 改"原始值"（影响 reset/校验基线） |
| `prinstine` | 原始值 |
| `formStore` / `formItem` | 表单 MST store / 当前控件的 formItem store（options/校验状态都在这） |
| `formMode` / `formInited` | normal/horizontal/inline/row，表单是否初始化完 |
| `disabled` / `btnDisabled` / `readOnly` | 汇总了表单级/条件级的禁用态 |
| `renderFormItems(schema, region, props)` | 表单容器内渲染子表单项（wizard/fieldSet 用） |
| `addHook/removeHook` | 挂表单提交钩子（返回 Promise 会阻塞提交） |
| `onFocus` / `onBlur` / `onOpenDialog` | 聚焦/失焦/打开 dialog（formItem 的弹窗选择器用） |

### config 常用字段（FormItemBasicConfig，Item.tsx:510-539）

- `strictMode`（默认 true）：配合 `detectProps` 白名单，**只有白名单属性变化才向下重渲染**（Item.tsx:2309-2330 的 shouldComponentUpdate）。排查"props 变了视图没更新"先看这里：要么把属性加进 config.detectProps，要么 `strictMode: false`。
- `validations`：默认校验规则（如 input-email 的 `'isEmail'`）。
- `validate`：老用法，新用法直接在组件类里定义 `validate()` 方法（异步校验返回 Promise）。
- `thin` / `sizeMutable` / `detectProps` / `renderLabel` / `renderDescription`。

## 3. @OptionsControl（packages/amis-core/src/renderers/Options.tsx，1487 行）

注册（:1443-1477）：内部生成 `OptionsControlBase` 子类再走 `registerFormItem({..., strictMode: false})`——**选项组件默认关闭 strictMode 白名单**。

### 注入 props（OptionsControlProps，Options.tsx:231-269，注入现场 :1374-1440）

`options`（已归一化）、`selectedOptions`、`onToggle(option, submitOnChange?, changeImmediately?)`、`onToggleAll()`、`setOptions/setLoading/reloadOptions`、`loading`、`deferLoad(option)`（懒加载子选项）、`leftDeferLoad/expandTreeOptions`、`onAdd/onEdit/onDelete`。

### options 语义（AMISFormItemWithOptions，Options.tsx:70-151）

- 静态 `options` 变化自动重新归一化（normalizeOptions）；
- `source` 支持 API 拉取与 `${变量}` 数据域解析（config `autoLoadOptionsFromSource: false` 可关）；
- 取值语义：`joinValues`（默认 true，label,value 拼串）、`extractValue`、`delimiter`、`multiple`、`labelField/valueField`；
- 树形懒加载：选项 `defer: true` + `deferApi`，展开时 `deferLoad` 拉取（:813-838）；
- 基类的 `handleToggle` 已实现"dispatchOptionEvent('change') → prevented 检查 → onChange"范式，简单场景直接用。

## 4. 事件系统（packages/amis-core/src/utils/renderer-event.ts）

- `dispatchEvent` 由 SchemaRenderer 注入（SchemaRenderer.tsx:581-599），最终走 renderer-event.ts:270-336：**第一个参数是字符串事件名**（'change'/'click'/'focus'/'blur'...）或 DOM 事件对象（此时取 `e.type`）。
- 流程：查 `renderer.props.onEvent[eventName]` → 未命中直接 resolve → `createRendererEvent` 造事件对象（含 `preventDefault()/stopPropagation()/setData()/data`，:80-142）→ 按 weight 降序执行动作链 → 返回 Promise<RendererEvent>。
- **统一范式：先 `await dispatchEvent('change', resolveEventData(this.props, {...}))`，`rendererEvent?.prevented` 则 return，再执行 `onChange`**。prevented 语义 = 用户动作链调用了 preventDefault，默认行为（改值/提交）取消。
- onEvent 配置结构（OnEventProps，:36-45）：`{weight, actions, debounce, track}`；支持 BroadcastChannel 全局事件（:203-247）。
- 真实范例：InputText 的 change/clear/click/focus/blur（InputText.tsx:319-443）、Radios 的 change（Form/Radios.tsx:73-104）、Action 的 handleAction（Action.tsx:644-722）。

## 5. Scoped 与数据域（packages/amis-core/src/Scoped.tsx）

- `ScopedContext`（:130）提供 `registerComponent/unRegisterComponent/getComponentByName/getComponentById/getComponents/reload/send/close/doAction`（IScopedContext，:104-127）。
- 组件侧标准写法（Action.tsx:611-626）：`static contextType = ScopedContext`；constructor 里 `scoped.registerComponent(this)`；`componentWillUnmount` 里 unRegister。
- `getComponentByName('a.b')` 支持点分层级，按 **schema 节点的 `name`（或 `id`）** 匹配（:187-192），找不到冒泡到父作用域。注意区分：schema 的 `name` 是查找名/数据字段名，注册表里的 renderer.name 是另一回事。
- `isolateScope: true` 时 factory 自动包 Scoped HOC（factory.tsx:223-225），组件拥有独立数据域。

## 6. 主题接入（packages/amis-core/src/theme.tsx）

- `themeable` HOC 从 `ThemeContext` 取主题名，注入 `classnames/classPrefix/theme`，并合并 `theme.components[themeKey]` 作为组件默认 props（theme.tsx:191）——组件声明 `static themeKey = 'xxx'` 即可让主题定制自己的默认 props（例：amis-ui Toast.tsx:115 `static themeKey = 'toast'`，cxd 主题给它配 `closeButton: true`）。
- `makeClassnames(ns)`（theme.tsx:45-61）把 `Foo` 替换成 `{ns}Foo`——**这就是类名必须大写开头的根本原因**，`cx('MyWidget')` 在 cxd 主题下生成 `cxd-MyWidget`。

主题体系完整说明见 **amis-custom-theme** skill。
