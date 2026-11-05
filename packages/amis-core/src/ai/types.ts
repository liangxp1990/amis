/**
 * @file AG-UI 协议类型定义(Agent-User Interaction Protocol)。
 *
 * 遵循 AG-UI 标准事件模型(https://docs.ag-ui.com),amis 自身不引入
 * @ag-ui/core 运行时,仅按协议数据形状实现,保证零依赖与可替换性。
 * 未知事件类型在解码层被忽略并告警,保证对协议演进的前向兼容。
 */

/** 消息角色:标准三种 + 开放扩展(由渲染层兜底为 assistant 样式) */
export type AguiRole = 'user' | 'assistant' | 'system' | (string & {});

/** AG-UI 标准事件类型常量(THINKING_* 为部分运行时支持的扩展) */
export const AGUI_EVENTS = {
  RUN_STARTED: 'RUN_STARTED',
  RUN_FINISHED: 'RUN_FINISHED',
  RUN_ERROR: 'RUN_ERROR',
  TEXT_MESSAGE_START: 'TEXT_MESSAGE_START',
  TEXT_MESSAGE_CONTENT: 'TEXT_MESSAGE_CONTENT',
  TEXT_MESSAGE_END: 'TEXT_MESSAGE_END',
  TOOL_CALL_START: 'TOOL_CALL_START',
  TOOL_CALL_ARGS: 'TOOL_CALL_ARGS',
  TOOL_CALL_END: 'TOOL_CALL_END',
  TOOL_CALL_RESULT: 'TOOL_CALL_RESULT',
  THINKING_START: 'THINKING_START',
  THINKING_CONTENT: 'THINKING_CONTENT',
  THINKING_END: 'THINKING_END',
  // agentscope 等实现使用 REASONING_* 命名(与 THINKING_* 语义相同,一并支持)
  REASONING_START: 'REASONING_START',
  REASONING_MESSAGE_START: 'REASONING_MESSAGE_START',
  REASONING_MESSAGE_CONTENT: 'REASONING_MESSAGE_CONTENT',
  REASONING_MESSAGE_CHUNK: 'REASONING_MESSAGE_CHUNK',
  REASONING_MESSAGE_END: 'REASONING_MESSAGE_END',
  REASONING_END: 'REASONING_END',
  STATE_SNAPSHOT: 'STATE_SNAPSHOT',
  STATE_DELTA: 'STATE_DELTA',
  MESSAGES_SNAPSHOT: 'MESSAGES_SNAPSHOT',
  RAW: 'RAW',
  CUSTOM: 'CUSTOM'
} as const;

/**
 * AG-UI 事件(宽松判别类型)。
 *
 * 协议边界层有意保持宽松:后端为不可信外部输入,字段由解码层保证
 * `type` 存在,其余字段由 reducer 按事件类型自行取用并容错。
 * 各事件携带字段:
 * - TEXT_MESSAGE_START: messageId, role
 * - TEXT_MESSAGE_CONTENT / TEXT_MESSAGE_END: messageId
 * - TEXT_MESSAGE_CONTENT.delta: 文本增量
 * - TOOL_CALL_START: toolCallId, toolCallName
 * - TOOL_CALL_ARGS: toolCallId, delta(参数 JSON 增量)
 * - TOOL_CALL_END: toolCallId
 * - TOOL_CALL_RESULT: toolCallId, content(结果,可为对象)
 * - THINKING_*: messageId?, delta
 * - STATE_SNAPSHOT: snapshot; STATE_DELTA: delta(JSON Patch 数组)
 * - MESSAGES_SNAPSHOT: messages
 * - RUN_ERROR: message, code?
 */
export interface AguiEvent {
  type: string;
  messageId?: string;
  role?: AguiRole;
  delta?: string | any[];
  toolCallId?: string;
  toolCallName?: string;
  content?: any;
  message?: string;
  code?: string | number;
  snapshot?: any;
  messages?: AguiMessage[];
  name?: string;
  value?: any;
  [key: string]: any;
}

/** AG-UI 消息(RunAgentInput.messages 的元素与 MESSAGES_SNAPSHOT 共用) */
export interface AguiMessage {
  id: string;
  role: AguiRole;
  content: string;
  [key: string]: any;
}

/** 暴露给 Agent 的工具描述 */
export interface AguiTool {
  name: string;
  description?: string;
  parameters?: any;
}

/** AG-UI run 请求入参(标准 RunAgentInput) */
export interface RunAgentInput {
  threadId: string;
  runId?: string;
  messages: AguiMessage[];
  state?: any[];
  tools?: AguiTool[];
  context?: any;
  forwardedProps?: Record<string, any>;
}

/** AG-UI 流式请求回调 */
export interface AguiFetchCallbacks {
  /** 每收到一个协议事件触发 */
  onEvent: (event: AguiEvent) => void;
  /** 传输/协议层错误(用户主动 abort 不触发) */
  onError: (error: Error) => void;
  /** 流正常结束 */
  onDone: () => void;
}

/** AG-UI 请求句柄,用于停止生成 */
export interface AguiFetchHandle {
  abort: () => void;
}

/**
 * AG-UI fetcher:发起一次 run 并以回调推送事件。
 * amis 渲染器从 `env.aguiFetcher` 注入;普通 React 组件场景由
 * props 注入或使用 {@link ./fetcher#defaultAguiFetcher} 默认实现。
 */
export type AguiFetcher = (
  endpoint: string,
  input: RunAgentInput,
  callbacks: AguiFetchCallbacks
) => AguiFetchHandle;
