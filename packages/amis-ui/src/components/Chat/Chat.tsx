/**
 * @file Chat:开箱即用的 AI 对话组合件(普通 React 组件,零 amis 渲染上下文依赖)。
 *
 * 内部用 useReducer 消费 AG-UI 事件流(amis-core src/ai 协议层),
 * 既可直接 `import { Chat } from 'amis-ui'` 使用,也被 amis 的
 * ai-chat 渲染器作为唯一 UI 实现复用(渲染器只做 schema→props 薄壳)。
 */
import React, {useCallback, useEffect, useReducer, useRef} from 'react';
import {
  AGUI_EVENTS,
  chatReducer,
  defaultAguiFetcher,
  initialChatState,
  themeable,
  uuid,
  type AguiEvent,
  type AguiFetcher,
  type AguiTool,
  type ChatMessage,
  type ChatState,
  type RunAgentInput,
  type ThemeProps
} from 'amis-core';
import ChatMessageView from './ChatMessage';
import ChatInput from './ChatInput';

/** 角色展示信息(头像/名称) */
export interface ChatRoleMeta {
  name?: string;
  avatar?: string;
}

export interface ChatProps extends ThemeProps {
  /** AG-UI 端点(POST RunAgentInput,返回 SSE) */
  endpoint?: string;
  /** 注入自定义 AG-UI fetcher;缺省用内置同源 fetch 实现 */
  fetcher?: AguiFetcher;
  /** 欢迎语(markdown),以伪消息展示,不参与发送历史 */
  welcome?: string;
  /** 空态提示语,点击即发送 */
  hints?: string[];
  /** 角色展示配置 */
  roles?: {
    user?: ChatRoleMeta;
    assistant?: ChatRoleMeta;
    system?: ChatRoleMeta;
  };
  /** 布局模式:全部气泡 / 仅用户气泡 / 无气泡 */
  mode?: 'bubble' | 'noBubble' | 'userBubble';
  /** 每次发送附加给 RunAgentInput.context 的业务上下文 */
  context?: any;
  /** 暴露给 Agent 的工具描述 */
  tools?: AguiTool[];
  /** 是否渲染思考过程条目,默认 true */
  showThinking?: boolean;
  /** 是否渲染工具调用卡片,默认 true */
  showToolCalls?: boolean;
  /** 是否显示停止生成按钮,默认 true */
  showStop?: boolean;
  /** 发送快捷键,默认 enter(另一个方向为 shift+enter) */
  sendHotKey?: 'enter' | 'shift+enter';
  placeholder?: string;
  /** 初始消息(如从持久化恢复) */
  initialMessages?: ChatMessage[];
  /** 禁用输入 */
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  onSendMessage?: (content: string) => void;
  /** 重新生成(截断最后一轮重发)时触发 */
  onRegenerate?: () => void;
  onFinish?: () => void;
  onError?: (message: string) => void;
  /** STATE_SNAPSHOT/STATE_DELTA 维护的 Agent 状态每次变化时回调 */
  onStateUpdate?: (state: any) => void;
}

/** 伪消息 id 前缀:welcome 等不参与发送历史 */
const INTERNAL_ID_PREFIX = '__';

/** 组装初始消息:initialMessages + welcome 伪消息 */
function createInitialState(props: ChatProps): ChatState {
  const welcomeMessage: ChatMessage | undefined = props.welcome
    ? {
        id: '__welcome',
        role: 'assistant',
        kind: 'text',
        content: props.welcome,
        status: 'complete'
      }
    : undefined;
  return {
    ...initialChatState,
    messages: [
      ...(props.initialMessages || []),
      ...(welcomeMessage ? [welcomeMessage] : [])
    ]
  };
}

function ChatBase(props: ChatProps) {
  const {
    classnames: cx,
    className,
    style,
    hints,
    roles,
    mode = 'bubble',
    showThinking = true,
    showToolCalls = true
  } = props;

  const [state, dispatch] = useReducer(chatReducer, createInitialState(props));
  // state 镜像:事件回调里取最新 messages 组装发送历史
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
    // 自动滚动:贴近底部时跟随新内容
    const el = messagesRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [state.messages]);

  const abortRef = useRef<{abort: () => void} | undefined>(undefined);
  const threadIdRef = useRef(`thread-${uuid()}`);
  const messagesRef = useRef<HTMLDivElement>(null);
  // props 镜像:回调始终拿到最新闭包,而 send/stop 保持稳定引用
  const propsRef = useRef(props);
  propsRef.current = props;

  // 卸载时中断在途请求
  useEffect(() => () => abortRef.current?.abort(), []);

  // agentState 变化对外回调(渲染器壳据此写数据域)
  const lastAgentStateRef = useRef<any>(undefined);
  const {agentState} = state;
  useEffect(() => {
    const {onStateUpdate} = propsRef.current;
    if (onStateUpdate && agentState !== lastAgentStateRef.current) {
      lastAgentStateRef.current = agentState;
      onStateUpdate(agentState);
    }
  }, [agentState]);

  const handleEvent = useCallback((event: AguiEvent) => {
    const latest = propsRef.current;
    dispatch({type: 'AGUI_EVENT', event});
    if (event.type === AGUI_EVENTS.RUN_FINISHED) {
      latest.onFinish?.();
    } else if (event.type === AGUI_EVENTS.RUN_ERROR) {
      latest.onError?.(String(event.message || 'Agent 运行出错'));
    }
  }, []);

  /** 发起一次 run(历史由调用方组装) */
  const doFetch = useCallback(
    (history: RunAgentInput['messages']) => {
      const latest = propsRef.current;
      abortRef.current?.abort();
      abortRef.current = (latest.fetcher ?? defaultAguiFetcher)(
        latest.endpoint!,
        {
          threadId: threadIdRef.current,
          // 部分实现(如 amis-agent-starter/agentscope)要求 runId 非空
          runId: `run-${uuid()}`,
          messages: history,
          context: latest.context,
          tools: latest.tools
        },
        {
          onEvent: handleEvent,
          onError: err => {
            dispatch({
              type: 'AGUI_EVENT',
              event: {type: AGUI_EVENTS.RUN_ERROR, message: err.message}
            });
            propsRef.current.onError?.(err.message);
          },
          // 流正常结束但后端未发 RUN_FINISHED 时的兜底收尾(STOP 幂等)
          onDone: () => dispatch({type: 'STOP'})
        }
      );
    },
    [handleEvent]
  );

  const send = useCallback(
    (text: string) => {
      const latest = propsRef.current;
      const content = text.trim();
      if (!content || !latest.endpoint || stateRef.current.running) {
        return;
      }
      const id = uuid();
      // 发送历史:既有消息 + 本条 user 消息;剔除伪消息与 tool/thinking 条目
      const history: RunAgentInput['messages'] = [
        ...stateRef.current.messages,
        {
          id,
          role: 'user' as const,
          kind: 'text' as const,
          content,
          status: 'complete' as const
        }
      ]
        .filter(
          m =>
            !m.id.startsWith(INTERNAL_ID_PREFIX) &&
            m.kind === 'text' &&
            m.status === 'complete'
        )
        .map(m => ({id: m.id, role: m.role, content: m.content}));

      dispatch({type: 'SEND', id, content});
      latest.onSendMessage?.(content);
      doFetch(history);
    },
    [doFetch]
  );

  /**
   * 重新生成:截断到最后一条 user 消息,重发同一内容
   * (ChatGPT 的 regenerate 语义)。
   */
  const regenerate = useCallback(() => {
    const latest = propsRef.current;
    if (!latest.endpoint || stateRef.current.running) {
      return;
    }
    const msgs = stateRef.current.messages;
    let lastUserIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (
        msgs[i].role === 'user' &&
        !msgs[i].id.startsWith(INTERNAL_ID_PREFIX)
      ) {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) {
      return;
    }
    const history: RunAgentInput['messages'] = msgs
      .slice(0, lastUserIdx + 1)
      .filter(
        m =>
          !m.id.startsWith(INTERNAL_ID_PREFIX) &&
          m.kind === 'text' &&
          m.status === 'complete'
      )
      .map(m => ({id: m.id, role: m.role, content: m.content}));

    dispatch({type: 'TRUNCATE', endIndex: lastUserIdx});
    dispatch({type: 'START_RUN'});
    latest.onRegenerate?.();
    doFetch(history);
  }, [doFetch]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    dispatch({type: 'STOP'});
  }, []);

  const visibleMessages = state.messages.filter(
    m =>
      m.kind === 'text' ||
      (m.kind === 'thinking' && showThinking !== false) ||
      (m.kind === 'tool' && showToolCalls !== false)
  );

  // 空态提示:尚未发生任何用户对话(welcome 伪消息不挡提示)
  const showHints =
    Array.isArray(hints) &&
    hints.length > 0 &&
    !state.messages.some(m => m.role === 'user');

  // 最后一条助手文本消息(重新生成按钮挂载位)
  let lastAssistantTextIndex = -1;
  visibleMessages.forEach((m, i) => {
    if (m.role === 'assistant' && m.kind === 'text') {
      lastAssistantTextIndex = i;
    }
  });

  // turn 聚合(对标 ChatGPT/Claude):连续的助手条目共享一个头像与名字,
  // thinking/tool/text 属于同一轮回答,避免"事件日志感"
  const turnStarts = new Set<number>();
  visibleMessages.forEach((m, i) => {
    if (
      i === 0 ||
      m.role !== 'assistant' ||
      visibleMessages[i - 1].role !== 'assistant'
    ) {
      turnStarts.add(i);
    }
  });

  const roleMetaOf = (role: string) =>
    roles?.[role as 'user' | 'assistant' | 'system'];

  return (
    <div className={cx('Chat', className)} style={style}>
      <div className={cx('Chat-messages')} ref={messagesRef}>
        {showHints ? (
          <div className={cx('Chat-hints')}>
            {hints.map((hint, index) => (
              <button
                key={index}
                type="button"
                className={cx('Chat-hint')}
                onClick={() => send(hint)}
              >
                {hint}
              </button>
            ))}
          </div>
        ) : null}
        {visibleMessages.map((message, index) => (
          <ChatMessageView
            key={message.id}
            message={message}
            mode={mode}
            roleMeta={roleMetaOf(message.role)}
            showAvatar={turnStarts.has(index)}
            canRegenerate={
              !state.running &&
              message.role === 'assistant' &&
              message.kind === 'text' &&
              index === lastAssistantTextIndex
            }
            onRegenerate={regenerate}
            classnames={cx}
          />
        ))}
      </div>
      <ChatInput
        classnames={cx}
        running={state.running}
        disabled={props.disabled}
        placeholder={props.placeholder}
        sendHotKey={props.sendHotKey}
        showStop={props.showStop}
        onSend={send}
        onStop={stop}
      />
    </div>
  );
}

export const Chat = themeable(ChatBase);
export default Chat;
