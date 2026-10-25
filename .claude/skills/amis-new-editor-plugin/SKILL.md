---
name: amis-new-editor-plugin
description: 开发 amis 可视化编辑器插件（amis-editor）时使用。触发场景：用户要求"让组件在编辑器里可编辑/新增编辑器插件/编辑器面板配置/组件拖入编辑器"。覆盖 BasePlugin 各字段、注册方式与编辑器工作原理。
---

# 开发 amis 编辑器插件

依据 docs/zh-CN/extend/editor.md。前提：**先有对应的 amis 渲染器**（@Renderer 注册过的 type），插件只是让它在编辑器中可拖入、可配置。

## 插件模板（v6 真实结构，以 captcha/Radios 插件为范本实证）

```tsx
// packages/amis-editor/src/plugin/Form/MyWidget.tsx（表单类在 Form/ 子目录）
import {
  EditorNodeType,
  RAW_TYPE_MAP,
  defaultValue,
  getSchemaTpl,
  registerEditorPlugin,
  BasePlugin,
  BaseEventContext,
  RendererPluginAction,
  RendererPluginEvent,
  tipedLabel
} from 'amis-editor-core';
import {
  getEventControlConfig,
  getActionCommonProps
} from '../../renderer/event-control/helper';

export class MyWidgetPlugin extends BasePlugin {
  static id = 'MyWidgetPlugin';
  static scene = ['layout'];
  // 必须与渲染器注册的 type 一致
  rendererName = 'my-widget';
  // v6 命名规范：AMISXxxSchema.json（由 build-schemas 生成）
  $schema = '/schemas/AMISMyWidgetSchema.json';

  name = '我的组件';
  isBaseComponent = true;          // 出现在内置组件区
  icon = 'fa fa-user';
  description = '组件描述';
  docLink = '/amis/zh-CN/components/my-widget';
  tags = ['表单项'];

  scaffold = {type: 'my-widget', label: '我的组件', name: 'myWidget'};
  // 预览：表单控件要包一层 form（wrapWithPanel:false）
  previewSchema: any = {
    type: 'form',
    className: 'text-left',
    mode: 'horizontal',
    wrapWithPanel: false,
    body: [{...this.scaffold}]
  };
  notRenderFormZone = true;        // 表单控件标配

  // 事件定义（dataSchema 描述事件数据，供动作链引用）
  events: RendererPluginEvent[] = [
    {eventName: 'change', eventLabel: '值变化', description: '...', dataSchema: [...]}
  ];
  // 动作定义：与组件 doAction 的分支一一对应，才会出现在动作面板
  actions: RendererPluginAction[] = [
    {actionType: 'clear', actionLabel: '清空', description: '...', ...getActionCommonProps('clear')}
  ];

  panelJustify = true;
  // 用 getSchemaTpl 组面板（不要手写裸 schema）：tabs → collapseGroup → 基本项
  panelBodyCreator = (context: BaseEventContext) => {
    return getSchemaTpl('tabs', [
      {
        title: '属性',
        body: getSchemaTpl('collapseGroup', [
          {
            title: '基本',
            body: [
              getSchemaTpl('layout:originPosition', {value: 'left-top'}),
              getSchemaTpl('formItemName', {required: true}),
              getSchemaTpl('label'),
              // API 类字段用 apiControl（mode:'row'），tipedLabel 带提示
              getSchemaTpl('apiControl', {
                mode: 'row',
                name: 'myApi',
                label: tipedLabel('接口', '说明文案')
              })
            ]
          },
          getSchemaTpl('status', {isFormItem: true})
        ])
      },
      {title: '外观', body: [getSchemaTpl('collapseGroup', [{title: 'CSS 类名', body: [getSchemaTpl('className', {label: '外层'})]}])]},
      {
        title: '事件',
        className: 'p-none',
        body: [getSchemaTpl('eventControl', {name: 'onEvent', ...getEventControlConfig(this.manager, context)})]
      }
    ]);
  };

  // 数据链注册（表单控件至少给个 string 类型）
  buildDataSchemas(node: EditorNodeType, region: EditorNodeType) {
    return {type: 'string', title: node.schema?.label || node.schema?.name, originalValue: node.schema?.value};
  }
}

// 文件底部自注册
registerEditorPlugin(MyWidgetPlugin);
```

**常用 getSchemaTpl 速查**（实证可用）：`tabs`/`collapseGroup`/`formItemName`/`label`/`remark`/`labelRemark`/`status`/`validation`/`apiControl`/`eventControl`/`className`/`layout:originPosition`/`valueFormula`/`style:classNames`/`theme:formItem`。字段联动用 `visibleOn/hiddenOn` 条件（如弹出模式专属配置 `visibleOn: 'this.displayMode === "popup"'`）。

内置组件的插件都在 `packages/amis-editor/src/plugin/`（简单组件单文件，复杂的在 Form/、CRUD2/ 等子目录），**写之前先找最相似的现有插件参考**（如 Radios.tsx、InputImage.tsx 的 apiControl 用法、Captcha.tsx 的完整范本）。

## 注册方式

**内置插件（本仓库开发）必须走第三步——barrel 导出**：

```tsx
// packages/amis-editor/src/plugin/index.ts 加一行（否则编辑器里找不到组件）
export * from './Form/MyWidget'; // 我的组件
```

文件底部的 `registerEditorPlugin(MyWidgetPlugin)` 在模块被加载时自注册；宿主侧二选一：

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
