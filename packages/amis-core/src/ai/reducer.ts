/**
 * @file AG-UI 事件归并状态机:把协议事件流折叠成 UI 直接可渲染的消息模型。
 * 纯函数实现,不依赖 React,可独立单测。
 */
import {AGUI_EVENTS} from './types';
import type {
  AguiContentBlock,
  AguiEvent,
  AguiMessage,
  AguiRole,
  ChatAttachment
} from './types';

/** 工具调用的 UI 视图模型 */
export interface ChatToolCall {
  id: string;
  name: string;
  /** 参数 JSON 文本(流式增量拼接) */
  args: string;
  state: 'running' | 'success' | 'error';
  /** 结果文本(对象会被 JSON.stringify) */
  result?: string;
}

/** 消息条目类别:文本 / 思考过程 / 工具调用 */
export type ChatMessageKind = 'text' | 'thinking' | 'tool';

/** UI 消息模型(每条 AG-UI 协议单元对应一条) */
export interface ChatMessage {
  id: string;
  role: AguiRole;
  kind: ChatMessageKind;
  content: string;
  status: 'loading' | 'streaming' | 'complete' | 'error';
  toolCall?: ChatToolCall;
  /** 用户消息携带的附件(图片等,渲染缩略图并随发送历史组装为多模态块) */
  attachments?: ChatAttachment[];
  /** RUN_ERROR 时挂错误说明 */
  error?: string;
}

/** 聊天组件状态 */
export interface ChatState {
  messages: ChatMessage[];
  /** 一次 run 进行中 */
  running: boolean;
  /** STATE_SNAPSHOT/STATE_DELTA 维护的 Agent 状态 */
  agentState: any;
}

export type ChatAction =
  | {type: 'SEND'; id: string; content: string; attachments?: ChatAttachment[]}
  | {type: 'AGUI_EVENT'; event: AguiEvent}
  | {type: 'STOP'}
  | {type: 'CLEAR'}
  /** 重新生成:保留 [0, endIndex] 含边界,丢弃其后条目 */
  | {type: 'TRUNCATE'; endIndex: number}
  /** 重新生成:压入 loading 占位(供 TEXT_MESSAGE_START 复用) */
  | {type: 'START_RUN'};

export const initialChatState: ChatState = {
  messages: [],
  running: false,
  agentState: undefined
};

/* ---------------- JSON Patch(RFC 6902 常用子集,不可变实现) ---------------- */

/** 解析 /a/0/b 形式路径,还原 ~0/~1 转义 */
function tokens(path: string): string[] {
  return String(path ?? '')
    .split('/')
    .filter(Boolean)
    .map(t => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}

/** 递归取值 */
function getIn(target: any, path: string[]): any {
  return path.reduce((obj, key) => (obj == null ? obj : obj[key]), target);
}

/** 递归不可变设值 */
function setIn(target: any, path: string[], value: any): any {
  if (!path.length) {
    return value;
  }
  const [head, ...rest] = path;
  const isIndex = /^\d+$/.test(head);
  const source = target ?? (isIndex ? [] : {});
  if (Array.isArray(source)) {
    // "-" 是 RFC 6902 的数组尾部追加
    const index = head === '-' ? source.length : Number(head);
    const next = source.slice();
    next[index] = setIn(next[index], rest, value);
    return next;
  }
  return {...source, [head]: setIn(source[head], rest, value)};
}

/** 递归不可变删除 */
function removeIn(target: any, path: string[]): any {
  if (!path.length) {
    return target;
  }
  const [head, ...rest] = path;
  if (target == null) {
    return target;
  }
  if (Array.isArray(target)) {
    const next = target.slice();
    if (!rest.length) {
      next.splice(Number(head), 1);
    } else {
      next[Number(head)] = removeIn(next[Number(head)], rest);
    }
    return next;
  }
  if (!(head in target)) {
    return target;
  }
  if (!rest.length) {
    const {[head]: _removed, ...restObj} = target;
    return restObj;
  }
  return {...target, [head]: removeIn(target[head], rest)};
}

/**
 * 应用一组 JSON Patch(add/remove/replace/move;test/copy 忽略)。
 *
 * @param target 原对象(不会被修改)
 * @param patches RFC 6902 patch 数组;非法项跳过并告警
 * @returns 新对象;patches 非数组时原样返回 target
 */
export function applyJsonPatch(target: any, patches: any): any {
  if (!Array.isArray(patches)) {
    console.warn('[agui] STATE_DELTA.delta 不是合法的 JSON Patch 数组,已忽略');
    return target;
  }
  let result = target ?? {};
  for (const patch of patches) {
    if (!patch || typeof patch.path !== 'string') {
      console.warn('[agui] 忽略非法 patch 项:', patch);
      continue;
    }
    switch (patch.op) {
      case 'add':
      case 'replace':
        result = setIn(result, tokens(patch.path), patch.value);
        break;
      case 'remove':
        result = removeIn(result, tokens(patch.path));
        break;
      case 'move': {
        const fromTokens = tokens(String(patch.from ?? ''));
        const value = getIn(result, fromTokens);
        result = setIn(removeIn(result, fromTokens), tokens(patch.path), value);
        break;
      }
      default:
        // test/copy 对前端状态无副作用
        break;
    }
  }
  return result;
}

/* ---------------- 事件归并 ---------------- */

/** 替换指定下标消息(map 写法,保持其余引用不变) */
function replaceAt(
  messages: ChatMessage[],
  index: number,
  patch: Partial<ChatMessage>
): ChatMessage[] {
  return messages.map((msg, i) => (i === index ? {...msg, ...patch} : msg));
}

/**
 * 收尾:流式中条目落定,运行中工具标记成功(协议未出 RESULT 的宽容处理)。
 *
 * @param messages 消息列表
 * @param options.keepPendingTools 为 true 时工具卡保持运行中(interrupt 挂起等待前端执行)
 */
function finalize(
  messages: ChatMessage[],
  options?: {keepPendingTools?: boolean}
): ChatMessage[] {
  return messages.map(msg => {
    const patch: Partial<ChatMessage> = {};
    if (msg.status === 'loading' || msg.status === 'streaming') {
      patch.status = 'complete';
    }
    if (
      msg.kind === 'tool' &&
      msg.toolCall?.state === 'running' &&
      !options?.keepPendingTools
    ) {
      patch.toolCall = {...msg.toolCall!, state: 'success'};
    }
    return Object.keys(patch).length ? {...msg, ...patch} : msg;
  });
}

/**
 * 聊天状态归并 reducer。
 *
 * @param state 当前状态
 * @param action SEND=用户发送 / AGUI_EVENT=协议事件 / STOP=本地停止 / CLEAR=清空
 * @returns 新状态(不可变)
 */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SEND':
      return {
        ...state,
        running: true,
        messages: [
          ...state.messages,
          {
            id: action.id,
            role: 'user',
            kind: 'text',
            content: action.content,
            attachments: action.attachments,
            status: 'complete'
          },
          // 立即出现的助手占位(loading 动画),TEXT_MESSAGE_START 到达时被复用
          {
            id: `__pending_${action.id}`,
            role: 'assistant',
            kind: 'text',
            content: '',
            status: 'loading'
          }
        ]
      };

    case 'STOP':
      return state.running
        ? {...state, running: false, messages: finalize(state.messages)}
        : state;

    case 'TRUNCATE':
      return {
        ...state,
        messages: state.messages.slice(
          0,
          Math.max(0, Math.min(action.endIndex, state.messages.length - 1)) + 1
        )
      };

    case 'START_RUN':
      return {
        ...state,
        running: true,
        messages: [
          ...state.messages,
          {
            id: `__pending_${Date.now()}`,
            role: 'assistant',
            kind: 'text',
            content: '',
            status: 'loading'
          }
        ]
      };

    case 'CLEAR':
      return {...initialChatState, agentState: state.agentState};

    case 'AGUI_EVENT':
      return reduceEvent(state, action.event);

    default:
      return state;
  }
}

/** 单个协议事件的归并(未知事件原样返回,不报错) */
function reduceEvent(state: ChatState, event: AguiEvent): ChatState {
  const messages = state.messages;
  const last = messages.length ? messages[messages.length - 1] : undefined;
  const indexOf = (predicate: (m: ChatMessage) => boolean) =>
    messages.findIndex(predicate);

  switch (event.type) {
    case AGUI_EVENTS.RUN_STARTED:
      return {...state, running: true};

    case AGUI_EVENTS.RUN_FINISHED: {
      // outcome.type === 'interrupt'(前端工具挂起-恢复模式,如 amis-agent-starter):
      // 运行中的工具卡保持等待态,由宿主执行工具后再次发起请求恢复
      const interrupted =
        event.outcome?.type === 'interrupt' ||
        Array.isArray(event.outcome?.interrupts);
      return {
        ...state,
        running: false,
        messages: interrupted
          ? finalize(messages, {keepPendingTools: true})
          : finalize(messages)
      };
    }

    case AGUI_EVENTS.RUN_ERROR: {
      const messageText =
        event.message || event.content?.message || 'Agent 运行出错';
      // 错误挂在最后一条未完成的助手条目上;否则追加一条错误条目
      const index = indexOf(
        m =>
          m.role === 'assistant' &&
          (m.status === 'streaming' || m.status === 'loading')
      );
      if (index >= 0) {
        return {
          ...state,
          running: false,
          messages: replaceAt(messages, index, {
            status: 'error',
            error: messageText
          })
        };
      }
      return {
        ...state,
        running: false,
        messages: [
          ...messages,
          {
            id: `__error_${Date.now()}`,
            role: 'assistant',
            kind: 'text',
            content: '',
            status: 'error',
            error: messageText
          }
        ]
      };
    }

    case AGUI_EVENTS.TEXT_MESSAGE_START: {
      const id = event.messageId || `__text_${Date.now()}`;
      // 复用 loading 占位
      if (last?.status === 'loading' && last.role === 'assistant') {
        return {
          ...state,
          messages: replaceAt(messages, messages.length - 1, {
            id,
            role: event.role || 'assistant',
            status: 'streaming'
          })
        };
      }
      return {
        ...state,
        messages: [
          ...messages,
          {
            id,
            role: event.role || 'assistant',
            kind: 'text',
            content: '',
            status: 'streaming'
          }
        ]
      };
    }

    case AGUI_EVENTS.TEXT_MESSAGE_CONTENT:
    case AGUI_EVENTS.THINKING_CONTENT:
    case AGUI_EVENTS.REASONING_MESSAGE_CONTENT:
    case AGUI_EVENTS.REASONING_MESSAGE_CHUNK: {
      const isThinking =
        event.type === AGUI_EVENTS.THINKING_CONTENT ||
        event.type === AGUI_EVENTS.REASONING_MESSAGE_CONTENT ||
        event.type === AGUI_EVENTS.REASONING_MESSAGE_CHUNK;
      const delta = typeof event.delta === 'string' ? event.delta : '';
      if (!delta) {
        return state;
      }
      // 优先按 messageId 精确定位;缺省时回退到最后一条流式中的同类条目
      let index = event.messageId ? indexOf(m => m.id === event.messageId) : -1;
      if (index < 0) {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (
            messages[i].kind === (isThinking ? 'thinking' : 'text') &&
            messages[i].status === 'streaming'
          ) {
            index = i;
            break;
          }
        }
      }
      if (index < 0) {
        return state;
      }
      return {
        ...state,
        messages: replaceAt(messages, index, {
          content: messages[index].content + delta
        })
      };
    }

    case AGUI_EVENTS.THINKING_START:
    case AGUI_EVENTS.REASONING_MESSAGE_START: {
      const thinking: ChatMessage = {
        id: event.messageId || `__thinking_${Date.now()}`,
        role: 'assistant',
        kind: 'thinking',
        content: '',
        status: 'streaming'
      };
      // 复用 loading 占位:避免"••• 空占位 + 思考卡片"并存
      if (last?.role === 'assistant' && last.status === 'loading') {
        return {
          ...state,
          messages: replaceAt(messages, messages.length - 1, thinking)
        };
      }
      return {...state, messages: [...messages, thinking]};
    }

    case AGUI_EVENTS.THINKING_END:
    case AGUI_EVENTS.REASONING_MESSAGE_END: {
      const index = indexOf(
        m => m.kind === 'thinking' && m.status === 'streaming'
      );
      return index >= 0
        ? {...state, messages: replaceAt(messages, index, {status: 'complete'})}
        : state;
    }

    case AGUI_EVENTS.TEXT_MESSAGE_END: {
      const index = indexOf(m => m.id === event.messageId);
      return index >= 0
        ? {...state, messages: replaceAt(messages, index, {status: 'complete'})}
        : state;
    }

    case AGUI_EVENTS.TOOL_CALL_START: {
      const tool: ChatMessage = {
        id: event.toolCallId || `__tool_${Date.now()}`,
        role: 'assistant',
        kind: 'tool',
        content: '',
        status: 'streaming',
        toolCall: {
          id: event.toolCallId || '',
          name: event.toolCallName || 'unknown-tool',
          args: '',
          state: 'running'
        }
      };
      // 复用 loading 占位:避免"••• 空占位 + 工具卡片"并存
      if (last?.role === 'assistant' && last.status === 'loading') {
        return {
          ...state,
          messages: replaceAt(messages, messages.length - 1, tool)
        };
      }
      return {...state, messages: [...messages, tool]};
    }

    case AGUI_EVENTS.TOOL_CALL_ARGS: {
      const delta = typeof event.delta === 'string' ? event.delta : '';
      const index = indexOf(
        m => m.kind === 'tool' && m.id === event.toolCallId
      );
      if (index < 0 || !delta) {
        return state;
      }
      const msg = messages[index];
      return {
        ...state,
        messages: replaceAt(messages, index, {
          toolCall: {...msg.toolCall!, args: msg.toolCall!.args + delta}
        })
      };
    }

    case AGUI_EVENTS.TOOL_CALL_RESULT: {
      const index = indexOf(
        m => m.kind === 'tool' && m.id === event.toolCallId
      );
      if (index < 0) {
        return state;
      }
      const msg = messages[index];
      const result =
        event.content == null
          ? undefined
          : typeof event.content === 'string'
          ? event.content
          : JSON.stringify(event.content, null, 2);
      return {
        ...state,
        messages: replaceAt(messages, index, {
          status: 'complete',
          toolCall: {...msg.toolCall!, state: 'success', result}
        })
      };
    }

    case AGUI_EVENTS.STATE_SNAPSHOT:
      return {...state, agentState: event.snapshot};

    case AGUI_EVENTS.STATE_DELTA:
      return {
        ...state,
        agentState: applyJsonPatch(state.agentState, event.delta)
      };

    case AGUI_EVENTS.MESSAGES_SNAPSHOT:
      return {
        ...state,
        messages: (Array.isArray(event.messages) ? event.messages : []).map(
          (m: any): ChatMessage => ({
            id: String(m?.id ?? `__snap_${Math.random()}`),
            role: m?.role ?? 'assistant',
            kind: 'text',
            content: typeof m?.content === 'string' ? m.content : '',
            status: 'complete'
          })
        )
      };

    // RAW/CUSTOM/TOOL_CALL_END/未知事件:不影响消息模型
    default:
      return state;
  }
}

/**
 * 附件 → AG-UI 类型化内容块。
 *
 * dataURL(data:<mime>;base64,<data>)拆为 data 源(裸 base64 +
 * mimeType);http(s) 地址拆为 url 源。块类型按 mimeType 前缀分派
 * image/audio/video,与 agentscope-java 输入侧支持的块一致。
 *
 * @param att 输入区产出的附件模型
 * @returns 多模态内容块
 */
export function attachmentToBlock(att: ChatAttachment): AguiContentBlock {
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(att.url);
  if (match) {
    return {
      type: mediaKindOf(match[1]),
      source: {type: 'data', value: match[2], mimeType: match[1]}
    };
  }
  return {
    type: mediaKindOf(att.mimeType),
    source: {type: 'url', value: att.url}
  };
}

/**
 * UI 消息 → AG-UI 协议消息(发送历史元素)。
 *
 * 无附件时 content 保持纯文本 string(标准 AG-UI,兼容所有实现);
 * 有附件时组装为类型化块数组:文本块(有文字才加) + 附件块。
 *
 * @param message UI 消息模型(kind 非文本的条目由调用方过滤)
 * @returns RunAgentInput.messages 元素
 */
export function toAguiMessage(message: ChatMessage): AguiMessage {
  if (!message.attachments?.length) {
    return {id: message.id, role: message.role, content: message.content};
  }
  const blocks: AguiContentBlock[] = [];
  if (message.content) {
    blocks.push({type: 'text', text: message.content});
  }
  for (const att of message.attachments) {
    blocks.push(attachmentToBlock(att));
  }
  return {id: message.id, role: message.role, content: blocks};
}

/** 按 mimeType 前缀映射内容块类型,非媒体类兜底为 image */
function mediaKindOf(mimeType: string): 'image' | 'audio' | 'video' {
  if (mimeType.startsWith('audio/')) {
    return 'audio';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  return 'image';
}
