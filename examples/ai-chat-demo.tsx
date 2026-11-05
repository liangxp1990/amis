/**
 * @file ai-chat 演示页:amis 渲染器 与 独立 React 组件 两种形态共用同一个 mock AG-UI 事件流。
 *
 * mockFetcher 完整模拟了 AG-UI 标准事件序列(THINKING → TOOL_CALL →
 * TEXT_MESSAGE 流式 → STATE_SNAPSHOT → RUN_FINISHED),同时也是一个
 * "如何编写自定义 aguiFetcher" 的参考实现。
 */
import React from 'react';
import {createRoot} from 'react-dom/client';
import {embed} from './embed';
// 直连源码路径:vite dev 即时生效,且类型随源码演进(产物 lib 存在滞后)
import {Chat} from '../packages/amis-ui/src/components/Chat';
import type {
  AguiContentBlock,
  AguiEvent,
  AguiFetcher,
  RunAgentInput
} from 'amis-core';

/** 可中断的延时 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 从消息 content(纯文本或多模态块数组)提取文本与附件块 */
function parseContent(
  content: string | AguiContentBlock[]
): {text: string; imageCount: number} {
  if (typeof content === 'string') {
    return {text: content, imageCount: 0};
  }
  let text = '';
  let imageCount = 0;
  for (const block of content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'image') {
      imageCount++;
    }
  }
  return {text, imageCount};
}

/**
 * 模拟 AG-UI SSE 事件流的 fetcher。
 *
 * @param endpoint 端点(演示中忽略)
 * @param input RunAgentInput,取最后一条用户消息生成回复
 * @param callbacks 事件回调
 * @returns 中断句柄
 */
const mockFetcher = (() => {
  let seq = 0;
  const fetcher: AguiFetcher = (
    endpoint: string,
    input: RunAgentInput,
    callbacks
  ) => {
    const run = ++seq;
    let aborted = false;
    const emit = (event: AguiEvent) => {
      if (!aborted) {
        callbacks.onEvent(event);
      }
    };
    const {text: question, imageCount} = parseContent(
      input.messages[input.messages.length - 1]?.content ?? ''
    );

    (async () => {
      await sleep(200);
      emit({type: 'RUN_STARTED'});

      // 1. 思考过程
      emit({type: 'THINKING_START', messageId: `th-${run}`});
      for (const ch of `用户在问「${question}」，我先拆解一下意图，再决定调用哪个工具…`) {
        await sleep(18);
        emit({type: 'THINKING_CONTENT', messageId: `th-${run}`, delta: ch});
      }
      emit({type: 'THINKING_END', messageId: `th-${run}`});

      // 2. 工具调用
      emit({type: 'TOOL_CALL_START', toolCallId: `tc-${run}`, toolCallName: 'query_order'});
      await sleep(260);
      emit({
        type: 'TOOL_CALL_ARGS',
        toolCallId: `tc-${run}`,
        delta: `{"keyword": ${JSON.stringify(question)}, "limit": 10}`
      });
      await sleep(420);
      emit({
        type: 'TOOL_CALL_RESULT',
        toolCallId: `tc-${run}`,
        content: {rows: 3, total: 128, gmv: 36000}
      });

      // 3. 流式文本
      emit({type: 'TEXT_MESSAGE_START', messageId: `a-${run}`, role: 'assistant'});
      const reply =
        imageCount > 0
          ? `收到你上传的 **${imageCount} 张图片**（消息以多模态内容块发送）。\n\n` +
            `真实 GLM 视觉后端会识别图片内容；mock 流仅确认链路：文本「${question || '（无文字）'}」+ 图片 ${imageCount} 张。`
          : `已按「**${question || '空问题'}**」完成检索，结果如下：\n\n` +
            `| 指标 | 值 |\n| --- | --- |\n| 订单数 | 128 |\n| GMV | ¥36,000 |\n| 客单价 | ¥281 |\n\n` +
            `> 以上为 mock 数据。接入真实 AG-UI 后端(如 amis-agent-starter 的 /amis-agent/chat)` +
            `后，这里将展示 Agent 的真实回答与工具结果。`;
      for (const ch of reply) {
        await sleep(10);
        emit({type: 'TEXT_MESSAGE_CONTENT', messageId: `a-${run}`, delta: ch});
      }
      emit({type: 'TEXT_MESSAGE_END', messageId: `a-${run}`});

      // 4. 状态联动
      emit({type: 'STATE_SNAPSHOT', snapshot: {lastQuery: question, orders: 128}});
      emit({type: 'RUN_FINISHED'});
      if (!aborted) {
        callbacks.onDone();
      }
    })();

    return {abort: () => (aborted = true)};
  };
  return fetcher;
})();

/* ---------------- 左侧:amis 渲染器 + 真实后端 ----------------
 * 走 vite proxy(/amis-agent → 127.0.0.1:18090,见 vite.config.ts),
 * 需先启动 amis-agent-starter demo 后端;未启动时显示错误条属预期。
 */
embed(
  '#amis-root',
  {
    type: 'ai-chat',
    endpoint: '/amis-agent/chat',
    welcome:
      '你好，我是 **amis 渲染器** 里的 AI 助手（真实 GLM 后端）。\n\n试试让我修改页面，会触发工具调用；也可以点输入框左侧回形针上传图片让我识别。',
    hints: ['你好，介绍一下你自己', '帮我在页面顶部加一个按钮'],
    roles: {assistant: {name: 'JSON 助手'}, user: {name: '我'}},
    mode: 'userBubble',
    enableAttachment: true
  },
  {},
  {}
);

/* ---------------- 右侧:独立 React 组件 ---------------- */
function ReactDemo() {
  const [agentState, setAgentState] = React.useState(null);
  return (
    <div style={{height: '100%', display: 'flex', flexDirection: 'column'}}>
      {agentState != null ? (
        <details
          style={{
            padding: '4px 12px',
            fontSize: 12,
            color: '#57606a',
            borderBottom: '1px solid #e5e9ef',
            background: '#fafbfc'
          }}
        >
          <summary style={{cursor: 'pointer', userSelect: 'none'}}>
            Agent 状态(onStateUpdate)
          </summary>
          <code>{JSON.stringify(agentState)}</code>
        </details>
      ) : null}
      <div style={{flex: 1, minHeight: 0}}>
        <Chat
          endpoint="/amis-agent/chat"
          fetcher={mockFetcher}
          welcome="你好，我是**独立 React 组件**形态，没有经过 amis 渲染器。"
          hints={['查询本月订单', '分析 GMV 趋势']}
          roles={{assistant: {name: 'React 助手'}, user: {name: '我'}}}
          mode="userBubble"
          enableAttachment={true}
          onStateUpdate={setAgentState}
        />
      </div>
    </div>
  );
}

const reactRoot = document.querySelector<HTMLElement>('#react-root');
if (reactRoot) {
  createRoot(reactRoot).render(<ReactDemo />);
}
