---
name: amis-editor-usage
description: 在宿主应用中接入/使用 amis 可视化编辑器（amis-editor / amis-editor-core）时使用。触发场景：用户要求"集成编辑器/编辑器接入项目/Editor 组件怎么用/编辑器预览跨域/编辑器保存 schema"，区别于开发编辑器插件（那是 amis-new-editor-plugin）。
---

# amis 编辑器宿主接入与使用

依据 docs/zh-CN/extend/editor.md。参考项目：https://github.com/aisuda/amis-editor-demo，在线体验 https://aisuda.github.io/amis-editor-demo

## 选包

- **amis-editor**：需要编辑 amis 内置组件（含全部内置渲染器插件）
- **amis-editor-core**：只用自定义渲染器、不需要内置组件面板时（更小）

用法一致：`npm i amis-editor`，`import {Editor} from 'amis-editor'`。

## 核心 props

```tsx
<Editor
  value={schema}                 // amis json
  onChange={setSchema}           // 编辑器内改动回写
  preview={false}                // 预览模式切换
  isMobile={false}               // 移动端模式（iframe 预览）
  autoFocus
  theme="cxd"                    // 与渲染端主题保持一致
  amisEnv={{fetcher}}            // 透传给内嵌 amis 渲染，预览态发请求用它
  $schemaUrl="/schema.json"      // 代码模式属性提示；构建见下
  plugins={[MyPlugin]}           // 自定义插件（或 registerEditorPlugin 全局注册）
  schemaFilter={fn}              // 预览前的配置过滤
  disableBultinPlugin={false}
  disablePluginList={['xxx']}    // 禁用指定内置插件
/>
```

`$schemaUrl` 的 schema.json 由 `npm run build-schemas --workspace amis` 生成（packages/amis/schema.json），部署到静态目录即可。

## 常见接入问题

1. **预览跨域**：预览态在编辑器内直接请求原 api 会跨域，用 `schemaFilter` 做 proxy：

```tsx
schemaFilter={(schema, isPreview) => {
  if (isPreview && typeof schema.api === 'string') {
    return {...schema, api: '/api/proxy?url=' + encodeURIComponent(schema.api)};
  }
  return schema;
}}
```

2. **预览发不出请求**：`amisEnv.fetcher` 没传
3. **代码模式无提示**：$schemaUrl 未部署或路径 404
4. **保存的 schema 存库**：`onChange` 拿到的是最新 json（编辑器自动给节点加的 `$$id` 等编辑器字段，落库前可清洗）

## 生命周期事件（埋点/管控用）

`onInit`、`onActive`（点选）、`beforeInsert/afterInsert`、`beforeUpdate/afterUpdate`、`beforeReplace`、`beforeMove`、`beforeDelete`、`onDndAccept`（拖拽是否接收）、`onBuildPanels`（干预右侧面板）、`onBuildContextMenus` 等。before 系列返回 false 或 `event.preventDefault()` 可拦截操作。

## 本仓库内开发调试

`npm start` 后访问 `http://127.0.0.1:8888/packages/amis-editor/`。

## 多语言

SDK 传 locale；React 版 import `'amis-editor/lib/locale/en-US'` 之类后 props 传 `locale`。编辑器源码文案的提取/翻译用 `npm run i18n:update` / `i18n:translate`（根 i18nConfig.ts，覆盖 amis-editor 与 amis-editor-core）。
