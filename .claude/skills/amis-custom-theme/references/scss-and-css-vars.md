# SCSS 架构与 CSS 变量体系

**全部 scss 在 packages/amis-ui/scss/**（packages/amis/scss 不存在；amis 包的 css 是构建时从 amis-ui 复制的产物）。

## 1. 目录全景（packages/amis-ui/scss/）

```
_properties.scss    # 语义层 CSS 变量（:root 与 .AMISCSSWrapper，898 行）
_components.scss    # 组件层 CSS 变量（button/select 等细粒度默认值）
_variables.scss     # 残留 sass 变量（$ns/$remFactor/$colors map，逐渐被 CSS 变量替代）
_functions.scss  _mixins.scss  _utilities.scss  _thirds.scss  helper.scss
base/               # 动画/normalize/排版
components/         # ~90+ 组件样式；表单类在 form/ 子目录（form/_select.scss）
layout/             # aside/grid/hbox/header/layout/vbox
themes/             # 主题入口与变量（见 §3）
```

## 2. 三层 CSS 变量体系（理解了才能正确覆盖）

| 层 | 定义处 | 命名 | 示例 |
|---|---|---|---|
| token 层 | themes/_{主题}-variables.scss 的 `:root` | `--colors-{语义}-{1..10}`、`--fonts-size-N`、`--sizes-size-N`、`--borders-radius-N`、`--shadows-shadow-*` | `--colors-brand-5: #2468f2` |
| 语义层 | _properties.scss（`:root, .AMISCSSWrapper`） | 直观名 | `--primary: var(--colors-brand-5)`、`--text-color`、`--body-bg`、`--borderColor`、`--borderRadius`、`--gap-base` |
| 组件层 | _components.scss | `--{组件}-{状态}-{属性}` | `--button-primary-default-bg-color: var(--colors-brand-5)` |

组件样式消费示例（components/_button.scss:19-22）：

```scss
.#{$ns}Button--primary {
  @include button-variant(
    var(--button-primary-default-bg-color),
    var(--button-primary-default-font-color), ...);
}
```

**覆盖策略**：改整体观感动语义层；只改某组件动组件层；设计系统级换肤重定义 token 层。`.AMISCSSWrapper` 用于局部作用域（编辑器预览等场景），宿主全局覆盖直接写 `:root`。

## 3. 主题文件结构（themes/）

```
themes/
├── cxd.scss  antd.scss  ang.scss  dark.scss  default.scss(=cxd 兼容)   # 入口
├── _cxd-variables.scss  _antd-variables.scss  _ang-variables.scss  _dark-variables.scss
├── _common.scss          # 组件样式全集（按序 @import base/layout/全部 components）
└── *-ie11.scss           # CSS 变量静态化产物
```

入口固定四行（cxd.scss）：

```scss
@import '../properties';    // 语义层变量
@import '../components';    // 组件层变量
@import './cxd-variables';  // $ns: 'cxd-' + :root 全套 token
@import './common';         // 全部组件样式，#{$ns} 插值出 .cxd-*
```

`_common.scss` 被所有主题入口复用，`$ns` 决定类名前缀——**同一份组件样式按前缀编译出多份 css**。新组件样式必须在这里 @import（见 amis-new-renderer skill 第三步）。

## 4. 自定义主题实操（源码方式）

1. 复制 `_cxd-variables.scss` → `_my-variables.scss`：改 `$ns: 'my-'` + 调 token 值（色板/字号/圆角/阴影）
2. 新建 `my-theme.scss`：四行 import（把 `./cxd-variables` 换成 `./my-variables`）
3. amis-ui 的 rollup.config.js（:73-113）会对 `scss/themes/*.scss` 逐个 postcss extract 出 `lib/themes/my-theme.css`；本地快速验证可直接 `npx sass` 手工编译该入口
4. JS 注册：`theme('mytheme', {classPrefix: 'my-', classnames: makeClassnames('my-'), renderers, components})`
5. 宿主：引 `my-theme.css` + 渲染传 `{theme: 'mytheme'}`
6. 注意：升级 amis 版本需重新编译主题 css（官方因此不推荐此路线，见 docs/zh-CN/style/index.md:13）

## 5. 构建与产物链

```
packages/amis-ui/rollup.config.js:73-113
  → input 追加 scss/themes/{antd,ang,cxd,dark,default}.scss
  → postcss({extract: lib/themes/{name}.css}) 逐主题产出
packages/amis/build.sh
  → cp node_modules/amis-ui/lib/themes/*.css  lib/themes/     # amis 包只是中转
  → postcss 静态化 CSS 变量生成 *-ie11.css
  → fis3 生成 sdk/sdk.css(=cxd)/antd.css/dark.css/ang.css
宿主引用：import 'amis/lib/themes/cxd.css' 或 <link src="sdk/antd.css">
```

没有独立的 build-theme npm script；主题 css 随包构建。

## 6. 运行时 CSS 变量：page.cssVars（Page.tsx:385-411）

`updateVarStyle()` 遍历 `props.cssVars`：key 必须以 `--` 开头且不含 `:`；值含 `expression(` 或 `;` 的直接丢弃（防 CSS 注入）；拼成 `:root {...}` 写入内联 `<style>`。不支持 IE11（ie11 产物里变量已被静态化）。动态换肤参考实现：examples/components/Theme.tsx + examples/components/theme/vars.tsx（每个变量带 cxd/antd 双主题默认值）。

## 7. 开发规约（packages/amis-ui/scss/README.md + _variables.scss 注释）

- 组件 scss **禁止 `@if` / `lighten()` / `darken()`**——它们无法转换成 CSS 变量，导致换肤失效；需要衍生色就在变量定义处用 `#{lighten($x, 5%)}`（插值在定义时求值）
- 新变量进 `_properties.scss`（语义）或 `_components.scss`（组件），默认值引用 token 层
- 负值用 `calc(var(--xxx) * -1)`；rem 换算用 `px2rem()`（_functions.scss）
- sass 变量（$colors map）仅用于定义期颜色计算，运行时定制一律走 CSS 变量
