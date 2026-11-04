---
title: SchemaNode
description:
type: 0
group: 🔧 类型
menuName: SchemaNode 配置节点
icon:
order: 19
---

SchemaNode 是指每一个 amis 配置节点的类型，支持`模板`、`Schema（配置）`以及`SchemaArray（配置数组）`三种类型

## 模板

```json
{
  "type": "page",
  "data": {
    "text": "World"
  },
  "body": "Hello ${text}!" // 输出 Hello World!
}
```

上例中的`body`属性所配置的属性值`"Hello ${text}!"`就是一个模板

更多使用说明见 [模板文档](../concepts/template)

## Schema 配置

`Schema`，即**组件的 JSON 配置**

**它至少需要一个`type`字段，用以标识当前`Schema`的类型。**

```json
{
  "type": "page",
  "data": {
    "text": "World"
  },
  "body": {
    "type": "tpl",
    "tpl": "Hello ${text}!" // 输出 Hello World!
  }
}
```

`type`, `data`, `body`这三个字段组成的`JSON`对象，便是一个`Schema`，它由`type`字段作为标识，指明当前 `Schema` 是 `Page`组件节点

而通过查看 [Page 组件属性表](../../components/page) 可知，`body`属性类型是`SchemaNode`，即可以在`body`中，嵌套配置其他组件。我们在这里，用`type`和`tpl` JSON 对象，配置了 `Tpl` 组件，渲染了一段模板字符串。

> amis 可以通过该方法，在`Schema`中嵌套配置其他`SchemaNode`，从而搭建非常复杂的页面应用。

### 配置显隐

所有的`Schema`类型都可以通过配置`visible`或`hidden`，`visibleOn`或`hiddenOn`来控制组件的显隐，下面是两种方式

##### 静态配置

通过配置`"hidden": true`或者`"visible": false`来隐藏组件

```schema: scope="body"
[
    {
        "type": "form",
        "body": [
            {
                "type": "input-text",
                "label": "姓名",
                "name": "name"
            }
        ]
    },
    {
        "type": "form",
        "hidden": true,
        "body": [
            {
                "type": "input-text",
                "label": "姓名",
                "name": "name"
            }
        ]
    }
]
```

下面那个表单被隐藏了。

##### 通过条件配置显隐

你也通过 [表达式](../concepts/expression) 配置`hiddenOn`，来实现在某个条件下禁用当前组件.

```schema: scope="body"
{
  "type": "form",
  "body": [
    {
      "type": "input-number",
      "label": "数量",
      "name": "number",
      "value": 0,
      "description": "调整数量大小查看效果吧！"
    },
    {
      "type": "input-text",
      "label": "文本",
      "name": "text",
      "hiddenOn": "this.number > 1",
      "description": "当数量大于1的时候，该文本框会隐藏"
    }
  ]
}
```

为了方便说明，我们在 form 中演示了条件显隐，实际上，只要当前数据域中数据有变化，都可以实现组件显隐

> `visible`和`hidden`，`visibleOn`和`hiddenOn`除了判断逻辑相反以外，没有任何区别

### 配置权限

> 自 6.14.3 起，所有 `Schema` 类型都可以配置 `permission` 字段，按**权限码**控制组件是否渲染（未通过则组件完全不渲染，DOM 中不存在，区别于上面的隐藏）。

```json
{
  "type": "button",
  "label": "删除用户",
  "level": "danger",
  "permission": "system:user:delete"
}
```

- `permission` 支持字符串或字符串数组（数组任一命中即渲染）
- 权限码的判定数据由宿主应用在初始化时传入：

```js
// JS SDK
const scoped = amis.embed('#root', schema, {
  permissionCodes: ['system:user:view', 'system:user:*']
});

// React npm（render 的第三个参数，与 fetcher 同级）
renderAmis(schema, {permissionCodes: currentUser.permissions}, env);
```

**通配规则**（用户持有的权限码支持通配）：

| 用户权限码 | 能否访问 `system:user:delete` | 说明 |
|---|---|---|
| `system:user:delete` | ✅ | 精确匹配 |
| `system:user:*` | ✅ | 段通配，覆盖 `system:user` 下所有操作（含 `system:user` 本身） |
| `*` | ✅ | 全量通配（超管），匹配一切权限码 |
| `system:role:*` | ❌ | 不越界，通配只作用于本前缀 |

**自定义判定**：传入 `checkPermission` 回调可覆盖内置判定（优先级高于 `permissionCodes`），适合角色体系、动态规则等场景：

```js
renderAmis(schema, {
  checkPermission: (permission, schema) => {
    // permission 为组件配置的权限码（string | string[]），返回 false 则不渲染
    return myACL.check(permission, currentUser);
  }
}, env);
```

> 宿主未传入 `permissionCodes` 与 `checkPermission` 时（未接入权限体系），所有 `permission` 配置不生效，组件正常渲染——权限能力对存量应用零影响。
>
> 可视化编辑器中，选中任意组件后在属性面板的"权限"页签可配置权限代码（多个用英文逗号分隔）。

## SchemaArray 配置数组

明白了何为`Schema`之后，你就会很轻松理解`SchemaArray`，它其实就是支持通过数组配置`Schema`，从而在某一节点层级下，配置多个组件

```json
{
  "type": "page",
  "data": {
      "name": "amis"
      "age": 1
  },
  "body": [
      {
        "type":"tpl",
        "tpl": "my name is ${name}" // 输出 my name is amis
      },
      {
        "type":"tpl",
        "tpl": "I am ${age} years old" // 输出 I am 1 years old
      }
  ]
}
```

非常容易看出来，我们给`body`属性，配置了数组结构的`Schema`，从而实现在`body`下，渲染两个`tpl`，来输入两段文字的效果
