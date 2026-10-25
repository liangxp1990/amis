---
name: amis-schema
description: 编写 amis JSON 配置（低代码使用层）时使用。触发场景：用户要求"用 amis 实现某页面/写个表单/配置 crud/怎么写 schema/数据联动怎么配"，或在低代码平台里通过 JSON 配置使用 amis 能力——不是改 amis 源码的场景。
---

# 用 amis 写低代码配置（schema）

"使用 amis"而非"开发 amis"。权威文档全在 `docs/zh-CN/`（components/ 每个组件一页、concepts/ 概念、types/ 类型），**写配置前先查对应组件文档，不要凭记忆猜属性**。

## 接入方式

- **JS SDK**：`<script src="sdk.js">` + `amis.embed('#root', schema, props, env)`，自带 fetcher，最省事
- **React npm**：`import {render as renderAmis} from 'amis'`，**必须自己实现 `env.fetcher`**（否则所有 api 配置无效），常用 env：notify/alert/confirm/jumpTo/updateLocation/getModalContainer/copy/theme
- **当 UI 库**：直接 `import {Button} from 'amis-ui'`，混合开发
- 返回的 `amisScoped.getComponentByName('page1.form1')` 可取组件实例（要求节点配了 name）

## 配置结构速记

每个节点 = `type`（用哪个组件）+ 其余属性（作为 props）。容器节点的子区域（body/actions/aside...）递归嵌套。

## 核心概念（配错最多的地方）

### 数据域与数据链
- 组件的 `initApi` 返回的 `data` 存入当前数据域；`name` 属性让值落域成变量
- 子组件能向上找父域变量，反之不行；tpl 里 `${xxx}` 从当前数据链取值

### 模板 vs 表达式（最容易混）
- `${xxx}`/`${a + b}`：**模板**，用于文本类属性（tpl 的 tpl、api url、title 等）
- `visibleOn`/`hiddenOn`/`disabledOn`/`requiredOn` 等 `xxxOn` 属性：**表达式**，直接写 `a > 1 && b == 'x'`，不要再用 `${}` 包整个
- 发送数据映射：api 的 `data: {a: '${b}'}`，响应则落在 data 域

### API 协议（后端必须遵守）
```json
{"status": 0, "msg": "", "data": {...}}
```
status 非 0 一律按失败处理并 toast msg。简单写法 `"api": "post:/api/xxx"`。适配老后端用 `requestAdaptor`/`responseAdaptor`（env 全局或单个 api 配置均可）。

### 事件动作（1.7.0+，复杂交互首选）
```json
{
  "type": "button",
  "onEvent": {
    "click": {
      "actions": [
        {"actionType": "toast", "args": {"msgType": "info", "msg": "提示"}},
        {"actionType": "setValue", "componentId": "targetId", "args": {"value": "x"}},
        {"actionType": "ajax", "args": {"api": "/api/xxx"}},
        {"actionType": "custom", "args": {"script": "doSomething()"}}
      ]
    }
  }
}
```
逻辑编排支持条件/循环/并行；组件可用事件见各组件文档底部事件表。旧式联动写法能换 onEvent 就换。

## 常用组件速查

| 需求 | type | 文档 |
|---|---|---|
| 页面容器 | `page`、`container`、`grid`、`flex`、`cards` | components/page.md |
| 表单 | `form` + `input-text`/`select`/`input-date`/`input-file` 等 | components/form/ |
| 表格增删改查 | `crud`（配 `api`/`columns`）或 `crud2` | components/crud.md |
| 弹窗/抽屉 | `dialog`/`drawer`（按钮 `actionType: 'dialog'` 触发） | components/dialog.md |
| 纯文本/富文本 | `tpl`/`markdown` | components/tpl.md |
| 数据拉取容器 | `service`（initApi + body） | components/service.md |
| 图表 | `chart`（echarts 配置） | components/chart.md |
| 向导/步骤 | `wizard`/`steps` | |

## 写 schema 的工作流

1. 明确数据来源（initApi/api/source）和交互（事件动作/联动）
2. 查 docs/zh-CN/components/ 对应组件文档确认属性（属性表 + 顶部示例均可交互参考）
3. 本地快速验证：`npm start` 的文档站里把示例粘进任意 schema 块实时改；或写最小单测渲染
4. mock 数据统一用 `/api/mock2/...`（本仓库 mock/ 目录实现，可参考加自己的 mock）

## 宿主平台注意

- 老配置升级有 compat 层自动转（amis-core/src/compat.ts）
- 全局文本替换：env `replaceText: {KEY: 'value'}`（1.5.0+），排除字段用 `replaceTextIgnoreKeys`
- 多语言：props 传 `locale`，React 版需自行 import 语言包（如 `'amis-ui/lib/locale/en-US'`）
