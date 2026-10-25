---
name: amis-new-editor-plugin
description: 开发 amis 可视化编辑器插件（amis-editor）时使用。触发场景：用户要求"让组件在编辑器里可编辑/新增编辑器插件/编辑器面板配置/组件拖入编辑器"。覆盖 BasePlugin 各字段、注册方式与编辑器工作原理。
---

# 开发 amis 编辑器插件

依据 docs/zh-CN/extend/editor.md。前提：**先有对应的 amis 渲染器**（@Renderer 注册过的 type），插件只是让它在编辑器中可拖入、可配置。

## 插件模板

```tsx
// packages/amis-editor/src/plugin/MyWidget.tsx
import {BasePlugin} from 'amis-editor-core';

export class MyWidgetPlugin extends BasePlugin {
  // 必须与渲染器注册的 type 一致
  rendererName = 'my-widget';

  // 关联的 schema 类型（在 packages/amis-editor/types/xxx.json 或引用现有）
  $schema = '/schemas/UnkownSchema.json';

  // 编辑器左侧组件列表中的显示信息
  name = '我的组件';
  description = '组件描述';
  // 决定出现在左侧哪个分组 tab
  tags = ['自定义', '表单项'];
  icon = 'fa fa-user';

  // 左侧列表的预览图（直接用组件自身 schema）
  previewSchema = {
    type: 'my-widget',
    target: 'demo'
  };

  // 拖入画布时的初始 schema
  scaffold = {
    type: 'my-widget',
    target: '233'
  };

  // 右侧配置面板（本身就是一段 amis schema，常用 tabs 结构）
  panelTitle = '我的组件';
  panelBody = [
    {
      type: 'tabs',
      tabsMode: 'line',
      tabs: [
        {
          title: '常规',
          body: [
            {
              name: 'target',
              label: 'Target',
              type: 'input-text'
            }
          ]
        },
        {title: '外观', body: []}
      ]
    }
  ];
}
```

内置组件的插件都在 `packages/amis-editor/src/plugin/`（简单组件单文件，复杂的在 Form/、CRUD2/ 等子目录），**写之前先找最相似的现有插件参考**，panelBody 里大量复用公共配置片段（可从其他插件 import，如 blurAction 等事件配置）。

## 注册方式（二选一）

```tsx
// 方式 1：全局注册，所有 Editor 实例生效
import {registerEditorPlugin} from 'amis-editor';
registerEditorPlugin(MyWidgetPlugin);

// 方式 2：按实例传入
<Editor plugins={[MyWidgetPlugin]} />
```

内置插件注意 `<Editor>` 的 `disableBultinPlugin` / `disablePluginList` 可以禁用。

## 编辑器工作原理（写插件排查问题必备）

1. 编辑器渲染 schema 时给**每个 json 节点**自动加 `$$id` 唯一 id
2. 复写 `rendererResolver`：渲染前基于 schema + 插件收集编辑器信息，收集到就用 `Wrapper` 包裹，Wrapper 把 `$$id` 写到 dom 上（`data-editor-id="$$id"`），点击时据此定位 json 节点
3. 容器区域用 `RegionWrapper` 包裹，dom 标记 `data-region="xxx" data-region-host="$$id"`，用于拖入新组件
4. 左侧组件列表 = 所有插件（rendererName/name/tags/previewSchema）的汇总

排查"组件在编辑器里点不动/不可编辑"：检查 rendererName 与渲染器 type 是否完全一致、插件是否注册成功（断点 rendererResolver）。

## 容器组件：定义 regions（可拖入子组件的区域）

渲染器侧通过 `this.props.render('body', body)` 实现的容器区域，插件里声明 regions 即可自动包裹 RegionWrapper：

```ts
regions: Array<RegionConfig> = [
  {key: 'body', label: '内容区'}  // key 必须与 render(region, ...) 的第一个参数一致
];
```

## 面板进阶：panelBodyCreator

`panelBody` 是静态的；需要按上下文出不同面板（如表单内/外的按钮配置不同）用 `panelBodyCreator = context => [...]`，context 含 `selections`（选中节点，可能多个）、`node`、`schema`、`info`。也可实现 `buildEditorPanel(context, panels)` 完全自定义面板（推 render 函数）。

## 插件可注册的完整信息（getRendererInfo 自动收集 BasePlugin 属性）

常用：`name`（点选高亮框名称）、`searchKeywords`、`docLink`、`previewSchema`、`tags`、`scaffold`（拖入初始配置）/`scaffolds`（多个脚手架，如 Grid 两栏三栏）、`isBaseComponent`（内置 tab 还是自定义 tab）、`disabledRendererPlugin`（true 则不出现在组件面板）、`regions`、`multifactor`（多重身份，如 CRUD 既是 CRUD 又是 Table）、`scaffoldForm`（首次拖入/右键重建时的脚手架弹窗）。

运行态干预（编辑态特殊处理）：`wrapperProps`（默认下发属性，如 table 下发 resizeable:false 隐藏编辑态不该出现的功能）、`filterProps`（过滤 $$id/渲染假数据）、`wrapperResolve`（额外标记哪些 dom）、`vRendererConfig`（非渲染器的虚拟组件点选，如 Tabs 的 Tab）、`overrides`（复写渲染器原型方法）、`renderRenderer`（无视图组件自绘内容以便点选）。

## 完成检查清单（更新）

- [ ] rendererName 与渲染器 type 一致
- [ ] scaffold 可独立渲染（拖入即不报错）
- [ ] previewSchema 展示合理
- [ ] panelBody/panelBodyCreator 覆盖组件主要属性，风格与现有插件一致（tabs：常规/外观）
- [ ] 容器组件声明了 regions（key 对应 render() 的 region 名）
- [ ] tags/icon 与现有分组风格一致
- [ ] 本地验证：npm start 访问 /packages/amis-editor/ 拖入测试

## Editor 常用宿主 props（接入/联调时）

`value`（schema）、`onChange`、`preview`、`isMobile`、`$schemaUrl`（amis 产出的 schema.json 路径，代码模式提示用，构建见 `npm run build-schemas --workspace amis`）、`amisEnv`（透传给内嵌 amis 渲染）、`plugins`、`schemaFilter`（api proxy 解决预览跨域）、各类 before/after 生命周期事件（beforeInsert/afterUpdate/onActive 等，可 preventDefault）。
