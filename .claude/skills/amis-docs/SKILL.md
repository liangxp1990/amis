---
name: amis-docs
description: 编写或修改 amis 组件文档（docs/zh-CN）时使用。触发场景：用户要求"写文档/补文档/文档示例/更新组件文档"，或需要了解文档 frontmatter 规范、schema 示例代码块、文档注册到文档站的流程。
---

# amis 组件文档编写

amis 文档的最大特点：**文档即示例**——markdown 里的 ` ```schema ` 代码块会被文档站实时渲染成可交互示例，写文档 = 写可运行的 demo。

## 文件位置与注册

1. 新建 `docs/zh-CN/components/<name>.md`（组件文档）、概念类放 `docs/zh-CN/concepts/`、类型说明放 `docs/zh-CN/types/`
2. **注册到文档站**：`examples/components/Components.tsx` 里按分组（布局/表单/展示…）添加：

```tsx
{
  label: 'MyWidget 我的组件',
  path: '/zh-CN/components/my-widget',
  component: React.lazy(() =>
    import('../../docs/zh-CN/components/my-widget.md').then(wrapDoc)
  )
},
```

3. 本地验证：`npm start` 后访问 `http://127.0.0.1:8888/zh-CN/components/my-widget`（按 Components.tsx 中的分组导航找到入口）

## frontmatter 规范（照抄现有文件改）

```yaml
---
title: MyWidget 我的组件
description:
type: 0
group: ⚙ 组件
menuName: MyWidget 我的组件
icon:
order: 27        # 控制在分组里的排序，参考相邻组件
---
```

## 文档结构（参考 docs/zh-CN/components/alert.md）

1. **一句话定位**：组件是干嘛的
2. **基本使用**：最简 schema 示例
3. **分节演示**：每个特性一节 + 一个 ` ```schema ` 示例，节标题用 `##`
4. **属性表**：标准表格（名称/类型/默认值/说明），字段名与 `AMISXxxSchema` 接口一一对应——**先读渲染器 TS 接口再写属性表，别凭记忆**
5. **事件表**（如有 onEvent 事件）：表格列出事件名与触发时机，配事件动作示例
6. **高级用法/组合**：与其它组件联动的典型场景

## schema 示例代码块

````markdown
```schema: scope="body"
{
  "type": "alert",
  "body": "提示文案",
  "level": "info"
}
```
````

- `scope="body"` 表示示例外层渲染在 body 作用域（不带则默认整页渲染，需要自己包 page）
- 示例**必须可独立运行**：所有 mock 数据用 `/api/mock2/...` 官方 mock 接口（见 mock/ 目录），不要写死不存在的接口
- 演示所有功能点，用户只看示例学组件
- 想展示"只有配置没有渲染"用普通 json 代码块（```json```）

## 注意事项

- 文档是中文的；组件名在标题里带中文说明（如 `MyWidget 我的组件`）
- markdown 里的示例修改后文档站热更新，实时改实时看
- 组件有主题/移动端差异时分别给示例说明
- 修文档 typo 之类的提交信息惯例见 git log：`doc-fix`
