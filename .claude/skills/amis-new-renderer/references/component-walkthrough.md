# 常见组件源码走读（新增组件前照抄最像的那个）

五个代表性组件，从简到繁覆盖所有组件形态。摘录均为真实源码（master v6.x），节选核心。

## 1. Alert —— 最简展示型渲染器（packages/amis/src/renderers/Alert.tsx）

结构：amis-ui 基础组件（Alert2）+ amis 注册壳。109 行，新写展示组件的起点。

```tsx
import React from 'react';
import {
  Renderer, RendererProps, AMISSchemaBase, AMISTemplate,
  AMISSchemaCollection, AMISIcon, AMISButtonSchema
} from 'amis-core';
import {Alert2 as Alert} from 'amis-ui';

export interface AMISAlertSchema extends AMISSchemaBase {
  type: 'alert';
  title?: AMISTemplate;
  body: AMISSchemaCollection;
  level?: 'info' | 'warning' | 'success' | 'danger';
  showCloseButton?: boolean;
  showIcon?: boolean;
  icon?: AMISIcon;
  actions?: AMISButtonSchema[];
}

@Renderer({type: 'alert'})
export class AlertRenderer extends React.Component<
  Omit<AlertProps, 'actions'> & RendererProps
> {
  render() {
    let {render, body, level, icon, showIcon, actions, ...rest} = this.props;
    // 属性支持 ${} 变量的手工方案（autoVar 之外的写法）
    if (isPureVariable(level)) {
      level = resolveVariableAndFilter(level, this.props.data);
    }
    const actionsDom = actions
      ? React.isValidElement(actions) ? actions : render('alert-actions', actions)
      : null;
    return (
      <Alert {...rest} level={level} icon={icon} showIcon={showIcon} actions={actionsDom}>
        {render('body', body)}   {/* 子节点必须经 render()，不能自己递归渲染 */}
      </Alert>
    );
  }
}
```

**抄什么**：Schema 接口注释规范、`{...rest} + 具名属性` 转发给基础组件、`render('body', body)` 渲染子区域。样式在 packages/amis-ui/scss/components/_alert.scss。

## 2. Action —— 交互型（按钮，packages/amis/src/renderers/Action.tsx）

要点：**一个 @Renderer + alias 多类型注册**（:604-609）：

```tsx
@Renderer({type: 'action', alias: ['button', 'submit', 'reset']})
@withBadge
export class ActionRenderer extends Action {}
```

- 原生 button type：`allowedType = ['button', 'submit', 'reset']`，schema type 落在其中就用之，否则 'button'（:528）。
- 点击核心 `handleAction`（:644-722）：`confirmText` 有值先弹确认 → `dispatchEvent(e, mergedData)` → `rendererEvent?.prevented` 则中断 → `onAction(e, action, mergedData)` 走动作系统（dialog/drawer/ajax/link 等行为都在这后面）。
- hover 事件直接把 DOM 事件对象传给 dispatchEvent，事件名取 `e.type`（:724-744）。
- Scoped 注册（:611-626）：`static contextType = ScopedContext` + constructor `scoped.registerComponent(this)`——外部 `getComponentByName` 才能找到它。

**抄什么**：alias 注册、确认弹窗分支、事件分发后 prevented 检查、Scoped 注册。样式复用 _button.scss（没有 _action.scss）。

## 3. InputText —— 表单项壳 + 完整事件（packages/amis/src/renderers/Form/InputText.tsx）

基础组件（Input/Spinner 等）来自 amis-ui，TextControl 只做表单语义适配，注册（:1371-1387）：

```tsx
@OptionsControl({
  type: 'input-text',
  alias: ['input-password', 'native-date', 'native-time', 'native-number']
})
export class TextControlRenderer extends TextControl {}

@OptionsControl({type: 'input-email', validations: 'isEmail'})
export class EmailControlRenderer extends TextControl {}   // 同一实现多种注册

@OptionsControl({type: 'input-url', validations: 'isUrl'})
export class UrlControlRenderer extends TextControl {}
```

五类事件的统一写法（:319-443）：

```tsx
// 改值（resetValue 为例，clearValue 同款）
const changeEvent = await dispatchEvent('change', resolveEventData(this.props, {value: pristineVal}));
if (changeEvent?.prevented) return;
onChange(pristineVal);

// click/focus/blur 各自 dispatch 对应字符串事件名
await dispatchEvent('click', resolveEventData(this.props, {value}));
```

**抄什么**：一实现多注册 + validations、基础组件转发（getInputProps 透传 disabled/readOnly/maxLength...）、每个用户可感知动作都先 dispatchEvent。样式在 amis-ui/scss/components/form/_text.scss。

## 4. Radios —— OptionsControl 范本（packages/amis/src/renderers/Form/Radios.tsx）

选项组件最少代码形态：Schema 继承 `AMISFormItemWithOptions`，props 继承 `OptionsControlProps`：

```tsx
export interface AMISRadiosSchema extends AMISFormItemWithOptions {
  type: 'radios';
  columnsCount?: number;
}

export interface RadiosProps extends OptionsControlProps {
  columnsCount?: number;
  labelField?: string;
  optionClassName?: string;
}

export default class RadiosControl extends React.Component<RadiosProps, any> {
  static defaultProps: Partial<RadiosProps> = {columnsCount: 1};

  doAction(action, data, throwErrors) {  // 响应组件动作 setValue/clear/reset
    if (action?.actionType === 'clear') onChange?.('');
    else if (action?.actionType === 'reset') onChange?.(pristineVal ?? '');
  }

  @autobind
  async handleChange(option: Option) {
    const {joinValues, extractValue, valueField, onChange, dispatchEvent, options} = this.props;
    let value = option;
    if (option && (joinValues || extractValue)) {
      value = option[valueField || 'value'];   // joinValues/extractValue 语义自己处理
    }
    const rendererEvent = await dispatchEvent('change',
      resolveEventData(this.props, {value, options, items: options, selectedItems: option}));
    if (rendererEvent?.prevented) return;
    onChange && onChange(value);
  }

  render() { /* options/selectedOptions/labelField/valueField 直接转发给 amis-ui <Radios> */ }
}

@OptionsControl({type: 'radios', sizeMutable: false, thin: true})
export class RadiosControlRenderer extends RadiosControl {
  static defaultProps = {multiple: false, inline: true};
}
```

**抄什么**：`AMISFormItemWithOptions` 继承、`doAction` 响应组件动作（clear/reset）、`@supportStatic()` HOC（表单只读态）、OptionsControl 注册参数（sizeMutable/thin）。

## 5. Flex —— 容器型 render() 模式（packages/amis/src/renderers/Flex.tsx）

容器组件唯一正确姿势：子节点逐个经 `render(region, node, extraProps)` 渲染（:103-113）：

```tsx
renderItems() {
  const {items, render, disabled} = this.props;
  return children.map((item, key) =>
    render(`items/${key}`, item, {key: `items/${key}`, disabled})
  );
}
// 注册：@Renderer({type: 'flex'}) + @Renderer({type: 'flex-item'})
```

更复杂的容器看 Card.tsx：多区域混用 `render('toolbar/'+index, actionSchema)`、`render('title', titleTpl)`（Card.tsx:451-468, :640）。**region 名必须全局唯一且与编辑器插件 regions.key 一致**（见 amis-new-editor-plugin skill）。

## 选用速查

| 新组件形态 | 抄 | 关键装饰器 |
|---|---|---|
| 纯展示（无交互） | Alert | @Renderer |
| 按钮/触发行为 | Action | @Renderer + alias |
| 输入类表单项 | InputText | @OptionsControl（即使没有 options，表单输入组件惯用） |
| 选项类 | Radios（简单）/ Select（复杂） | @OptionsControl |
| 容器/布局 | Flex（简单）/ Card（多区域） | @Renderer + render(region) |
