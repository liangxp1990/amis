---
title: AI 对话
description:
type: 0
group: ⚙ 组件
menuName: AI 对话
icon:
order: 60
---

> 本组件基于 [AG-UI 协议](https://docs.ag-ui.com)（Agent-User Interaction Protocol）实现，需要后端提供 AG-UI 兼容端点（POST `RunAgentInput`，返回 SSE 事件流）。

AI 对话组件：消息流、流式输出、思考过程、工具调用卡片、与数据域联动，一个 JSON 配置得到完整的 AI 聊天页面。

## 基本用法

```schema
{
    "type": "page",
    "body": {
        "type": "ai-chat",
        "endpoint": "/amis-agent/chat",
        "welcome": "你好，我是页面助手，有什么可以帮你？",
        "hints": ["帮我总结这段数据", "生成一份周报", "解释这个页面的功能"],
        "style": { "height": 420 }
    }
}
```

`endpoint` 是 AG-UI 端点；上例为演示展示，需要后端实现该端点才能对话（不发送不产生请求）。

## 角色与布局

通过 `roles` 配置用户/助手名称与头像；`mode` 切换气泡布局：

- `bubble`：全部气泡（默认）
- `userBubble`：仅用户消息有气泡，助手消息平铺（适合 AI 助手场景）
- `noBubble`：全部平铺

```schema
{
    "type": "page",
    "body": {
        "type": "ai-chat",
        "welcome": "你好，我是**数据助手**",
        "mode": "userBubble",
        "roles": {
            "user": { "name": "我" },
            "assistant": { "name": "数据助手" }
        },
        "hints": ["查询本月销售额"],
        "style": { "height": 360 }
    }
}
```

## 数据域联动

AI 对话组件是数据链的一环：

- **发送携带上下文**：`agentContext` 支持数据映射，把页面数据（如当前用户、表格选中行）随每次发送传给 Agent；
- **Agent 状态写回数据域**：后端通过 `STATE_SNAPSHOT` / `STATE_DELTA`（JSON Patch）事件维护状态，组件收到后写入 `stateKey` 指定的变量（默认 `aiChatState`），页面其他组件可通过 `${aiChatState}` 实时联动。

```schema
{
    "type": "page",
    "body": {
        "type": "ai-chat",
        "endpoint": "/amis-agent/chat",
        "agentContext": {
            "userName": "${userName}",
            "scene": "order-analysis"
        },
        "stateKey": "aiChatState",
        "welcome": "把当前用户信息发给我试试",
        "style": { "height": 400 }
    }
}
```

在 form 中使用时，状态通过 `onBulkChange` 直接落入表单数据域；其余场景监听 `stateChange` 事件配合[变量赋值](../../concepts/event-action)动作写入数据域。

## 事件

| 事件名       | 触发时机           | 事件数据                     |
| ------------ | ------------------ | ---------------------------- |
| `sendMessage` | 用户发送消息       | `event.data.text` 消息内容   |
| `finish`      | 一轮回答完成       | -                            |
| `error`       | 运行出错           | `event.data.message` 错误信息 |
| `stateChange` | Agent 状态更新     | `event.data.value` 最新状态   |

## 工具调用与思考过程

AG-UI 后端推送 `TOOL_CALL_*` / `THINKING_*` 事件时，组件自动渲染工具调用卡片（名称/参数/结果/状态）与思考过程折叠块，无需额外配置。可用 `showToolCalls: false`、`showThinking: false` 关闭。

## 附件上传（图片识别）

开启 `enableAttachment` 后，输入框左下角出现「添加附件」按钮（回形针），选择图片后以缩略图暂存于输入框内，随消息一起发送，适合 GLM-4V / GLM-Flash 等视觉模型的图片识别场景：

```schema
{
  "type": "ai-chat",
  "endpoint": "/amis-agent/chat",
  "enableAttachment": true,
  "attachmentMaxSize": 5,
  "attachmentMaxCount": 9
}
```

- 图片以 base64 编码进消息内容（多模态内容块），**无需单独的上传接口**，但要求后端支持 AG-UI 类型化 content（agentscope-java 2.x 原生支持，会自动转换为模型侧的图片输入）；
- 文本与图片可混合发送，纯图片（无文字）也可发送；
- 已发送消息的气泡内会展示附件缩略图，点击可查看原图。

## 属性表

| 属性名         | 类型                            | 默认值       | 说明                                                                 |
| -------------- | ------------------------------- | ------------ | -------------------------------------------------------------------- |
| type           | `string`                        |              | 指定为 `ai-chat`                                                      |
| endpoint       | `string`                        |              | AG-UI 端点，支持 `${xxx}` 模板                                        |
| welcome        | `string`                        |              | 欢迎语，支持 markdown                                                 |
| hints          | `string[]`                      |              | 空态提示语，点击即发送                                                |
| roles          | `object`                        |              | 角色展示配置 `{user/assistant/system: {name, avatar}}`                 |
| mode           | `string`                        | `bubble`     | 气泡布局：`bubble` / `userBubble` / `noBubble`                        |
| agentContext   | `object`                        |              | 发送时随 RunAgentInput.context 上报的业务上下文，支持数据映射         |
| stateKey       | `string`                        | `aiChatState`| Agent 状态写回数据域的变量名                                          |
| tools          | `object[]`                      |              | 暴露给 Agent 的工具描述 `{name, description, parameters}`             |
| showThinking   | `boolean`                       | `true`       | 是否渲染思考过程                                                      |
| showToolCalls  | `boolean`                       | `true`       | 是否渲染工具调用卡片                                                  |
| showStop       | `boolean`                       | `true`       | 是否显示停止生成按钮                                                  |
| sendHotKey     | `string`                        | `enter`      | 发送快捷键：`enter` 或 `shift+enter`                                  |
| enableAttachment | `boolean`                     | `false`      | 是否启用附件按钮（多模态输入，需后端支持类型化 content）              |
| attachmentAccept | `string`                      | `image/*`    | 附件类型（HTML accept 值，如 `image/*`、`.pdf,.png`）                 |
| attachmentMaxSize | `number`                      | `5`          | 单个附件大小上限（MB）                                                |
| attachmentMaxCount | `number`                      | `9`          | 附件数量上限                                                          |
| placeholder    | `string`                        |              | 输入框占位符                                                          |
| initialMessages| |                              |              | 初始消息，用于恢复会话                                                |
| disabled       | `boolean`                       | `false`      | 禁用输入                                                              |

## 请求适配（env.aguiFetcher）

amis 自身不发请求。ai-chat 默认用内置的同源 `fetch` 实现；宿主需要统一鉴权、走网关或跨域访问时，在 `env` 上提供可选的 `aguiFetcher`：

```jsx
// 宿主应用
amisRender(schema, {
  env: {
    fetcher,
    // AG-UI 流式请求适配点(可选)
    aguiFetcher(endpoint, input, {onEvent, onError, onDone}) {
      // 实现宿主自己的流式请求,逐事件回调 onEvent({type: 'TEXT_MESSAGE_CONTENT', ...})
      return {abort() {/* 中断 */}};
    }
  }
});
```

## 作为普通 React 组件使用

本组件的 UI 实现位于 amis-ui，可脱离 amis 渲染器独立使用：

```jsx
import {Chat} from 'amis-ui';
// 需引入主题样式,如 amis-ui/lib/themes/cxd.css

<Chat
  endpoint="/amis-agent/chat"
  welcome="你好，我是助手"
  hints={['查询订单']}
  fetcher={myAguiFetcher /* 可选,默认同源 fetch */}
  onStateUpdate={state => {/* Agent 状态 */}}
/>;
```

完整属性与 amis schema 一一对应（`agentContext` 对应组件 prop `context`）。

## 与后端对接

组件遵循 AG-UI 标准事件协议，任何兼容后端均可接入（[LangGraph](https://docs.ag-ui.com/integrations/langgraph)、Agno、自研服务等）。自研后端需要：

1. `POST {endpoint}`，请求体为 `RunAgentInput`（`threadId` / `messages` / `context` / `tools`）；
2. 响应为 SSE 流，逐条推送标准事件：`RUN_STARTED` → `TEXT_MESSAGE_START/CONTENT/END`（流式文本）、`TOOL_CALL_*`（工具调用）、`THINKING_*`（思考过程）、`STATE_SNAPSHOT/DELTA`（状态联动）、`RUN_FINISHED` / `RUN_ERROR`。

携带附件（图片）时，消息的 `content` 为类型化内容块数组（多模态扩展），纯文本消息仍为 string：

```json
{
  "id": "m1",
  "role": "user",
  "content": [
    {"type": "text", "text": "这张图是什么？"},
    {"type": "image", "source": {"type": "data", "value": "<base64>", "mimeType": "image/png"}}
  ]
}
```

agentscope-java 2.x 的 AG-UI 端点原生支持该形态，会把 image 块转换为模型侧多模态输入（如 GLM 视觉模型的图片识别）。
