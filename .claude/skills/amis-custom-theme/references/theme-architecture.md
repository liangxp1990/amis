# 主题系统源码详解

全部事实来自 master（v6.x）源码核实。行号会漂移，以内容为准。

## 1. 核心文件：packages/amis-core/src/theme.tsx（226 行）

**注意：主题管理在 amis-core，不在 amis-ui**（amis-ui/src/theme.tsx 不存在）。

### ThemeConfig（theme.tsx:17-27）

```ts
interface ThemeConfig {
  classPrefix?: string;   // 类名前缀，如 'cxd-'
  renderers?: {[name: string]: any};   // 按渲染器 type 注入默认 props
  components?: {[name: string]: any};  // 按 themeKey 注入 amis-ui 组件默认 props
  [propName: string]: any;
}
```

内置注册表初始只有 default/cxd（:29-34），其余主题靠 side-effect import 补注册。

### 全部导出 API

| API | 位置 | 说明 |
|---|---|---|
| `theme(name, config)` | :36-41 | 注册/合并主题配置（浅合并到已有配置） |
| `hasTheme(name)` | :69-71 | 判断注册表里有无 |
| `setDefaultTheme(name)` | :73-77 | 改全局默认（初始 `defaultTheme = 'cxd'` :127） |
| `getTheme(name?)` | :87-112 | 取 ThemeInstance（惰性补齐 getRendererConfig/getComponentConfig/classnames；空名回退 'cxd'） |
| `makeClassnames(ns)` | :45-61 | 造 cx 函数：`Foo` → `{ns}Foo`（正则 `/(^|\s)([A-Z])/g`，**这就是类名必须大写开头的原因**） |
| `themeable(Component, methods?)` | :130-225 | HOC：从 ThemeContext 取主题名，注入 classnames/classPrefix/theme，合并 `theme.components[themeKey]` 进默认 props（:191） |
| `ThemeContext` / `ThemeProps` / `classnames` / `getClassPrefix` | :128/:114-123/:79-85 | React context / props 类型 / 工具 |

amis-core 对外导出（amis-core/src/index.tsx:213-221）：`setDefaultTheme, theme, themeable, ThemeProps, getTheme, classPrefix, getClassPrefix, classnames, makeClassnames`。

**不存在的 API（旧资料谣传）**：`makeTheme()`、`ThemeProvider`、`themeManager`、`setTheme`（全仓库 grep 无匹配）。

## 2. 主题如何生效（渲染链路）

```
amis.render/embed(schema, props, env)      amis-core/src/index.tsx:379-382
  → theme = props.theme || env.theme || defaultTheme；'default' 归一为 'cxd'
  → env.theme = getTheme(theme)            // env 上挂的是已解析的 ThemeInstance
  → Root.tsx:88-97
      <ThemeContext.Provider value={themeName}>
  → RootRenderer 用 env.theme 的 classnames/classPrefix 下发给所有渲染器（Root.tsx:122-146）
  → 组件层：@Renderer 的 props.classnames(cx) + themeable HOC + getComponentConfig(themeKey)
```

三个注入通道分工：

| 通道 | 消费方 | 例子 |
|---|---|---|
| `renderers[type]` | factory 渲染器（schema 的 type） | cxd: `form.horizontal.leftFixed`、`pagination.maxButtons` |
| `components[themeKey]` | amis-ui 组件（声明 `static themeKey`） | cxd: `toast.closeButton: true`（Toast.tsx:115 `static themeKey = 'toast'`） |
| `classPrefix` | makeClassnames 生成的 cx | `.cxd-Button` |

## 3. 内置主题源码（packages/amis-ui/src/themes/，.ts 非 .tsx）

注册入口：`packages/amis-ui/src/index.tsx:7-11` 依次 `import './themes/{cxd,ang,antd,dark,default}'`（宿主引 `amis/lib/themes/antd` 即触发，见 examples/embed.tsx:20-23）。

| 主题 | classPrefix | 内容要点 |
|---|---|---|
| cxd.ts（云舍，默认） | `cxd-` | 459 行：toast 组件配置、form/pagination/fieldset/remark/tabs/range-control 等 renderer 默认值（:7-47）+ 整套 ECharts chartTheme 配色（:49-456） |
| antd.ts（仿 Antd） | `antd-` | 45 行：**没有 React 组件覆盖**，只有 classPrefix + 与 cxd 相同的默认 props；视觉差异全靠 scss/themes/_antd-variables.scss 的 token |
| ang.ts（1.2.2 前默认） | `a-` | 8 行，仅 classPrefix |
| dark.ts | `dark-` | 16 行：jsonTheme 'eighties'、editor-control 'vs-dark'；样式靠 dark.css（中性色板反转 + 额外覆盖块） |
| default.ts | - | 5 行，兼容壳：`export * from './cxd'` |

## 4. dark 是独立主题，不是变量开关

- `_dark-variables.scss`：`$ns: 'dark-'`（:4）+ neutral text/fill 1-11 号色与 cxd 顺序**整体反转**（:84-103）
- `dark.scss`：标准四行 import + 额外 `:root, .AMISCSSWrapper` 覆盖块（:6-34，如 `--button-primary-default-font-color`）
- 结论：cxd 的类名是 `.cxd-Button`，dark 是 `.dark-Button`，**在 cxd 页面上改 `:root` 变量做不出 dark**；必须引 dark.css + `env.theme: 'dark'`。

## 5. 常见误区

1. **"schema 里配 theme 属性"** —— 不存在；page 只有 `cssVars`（CSS 变量覆盖，Page.tsx:385-411）。
2. **"antd 主题 = antd 组件替换"** —— 不是，只是 classPrefix + 默认 props + CSS 变量换肤。
3. **"存在 makeTheme/ThemeProvider"** —— 不存在，见 §1。
4. **弹层不跟随主题** —— Toast/Alert 是独立 React 树，必须手动 `<ToastComponent theme={env.theme}>`（examples/embed.tsx:285-296）。
5. **改默认 props 想找 setTheme** —— 用 `theme('mytheme', {...})` 注册 + `setDefaultTheme('mytheme')` 或渲染时 env.theme 指定。
