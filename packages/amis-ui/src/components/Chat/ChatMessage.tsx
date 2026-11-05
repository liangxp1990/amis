/**
 * @file 单条聊天消息渲染,交互形态对标 ChatGPT/Claude/Gemini:
 * - 思考过程:整行摘要条(sparkles 图标+状态文案),流式展开/完成收起
 * - 工具调用:单行步骤(语义图标+工具名+状态),点击整行展开参数/结果
 * - 正文:markdown,流式末尾闪烁光标;底部操作行(复制/重新生成)
 * - 错误:错误条+重试按钮
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import type {ClassNamesFn} from 'amis-core';
import type {ChatMessage} from 'amis-core';
import type {ChatRoleMeta} from './Chat';
import Markdown from '../Markdown';
import {Icon} from '../icons';

export interface ChatMessageProps {
  message: ChatMessage;
  mode?: 'bubble' | 'noBubble' | 'userBubble';
  roleMeta?: ChatRoleMeta;
  /**
   * 是否渲染头像与名字(turn 聚合:同一轮助手回答的 thinking/tool/text
   * 共享首条的头像,false 时空占位保持缩进对齐)
   */
  showAvatar?: boolean;
  /** 是否为最后一条可重新生成的助手文本消息(显示重新生成按钮) */
  canRegenerate?: boolean;
  onRegenerate?: () => void;
  classnames: ClassNamesFn;
}

/**
 * 按工具名映射语义图标(对标 Claude/ChatGPT 的工具步骤图标)。
 *
 * @param name 工具名
 */
function toolIconOf(name: string): string {
  const n = name.toLowerCase();
  if (/(search|query|find|fetch|brows|web)/.test(n)) {
    return 'chat-search';
  }
  if (/(code|script|editor|schema|render|exec|run|cmd|shell)/.test(n)) {
    return 'chat-code';
  }
  if (/(db|sql|data|table|store|kv)/.test(n)) {
    return 'chat-database';
  }
  return 'chat-wrench';
}

/**
 * 复制文本到剪贴板,优先 Clipboard API,降级 execCommand。
 *
 * @param text 待复制内容
 */
async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (e) {
    // 继续走降级
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  } catch (e) {
    console.warn('[chat] 复制失败:', e);
  }
}

/** 三点加载动画(等待首个内容,行业一致形态) */
function ChatLoading({classnames: cx}: {classnames: ClassNamesFn}) {
  return (
    <span className={cx('Chat-loading')}>
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * 思考过程:整行摘要条,流式时展开实时内容,完成收起可回看。
 * 完成态显示思考时长(对标 ChatGPT "Thought for Ns")。
 */
function ThinkingRow({
  message,
  classnames: cx
}: {
  message: ChatMessage;
  classnames: ClassNamesFn;
}) {
  const streaming = message.status === 'streaming';
  const [open, setOpen] = useState(streaming);
  // 组件首次出现即流式开始,计时到结束
  const startedAt = useRef(Date.now());
  const [duration, setDuration] = useState(0);
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (streaming) {
      setOpen(true);
    } else if (wasStreaming.current) {
      setOpen(false);
      setDuration(
        Math.max(1, Math.round((Date.now() - startedAt.current) / 1000))
      );
    }
    wasStreaming.current = streaming;
  }, [streaming]);

  return (
    <div className={cx('Chat-thinking', streaming && 'is-streaming')}>
      <button
        type="button"
        className={cx('Chat-thinking-toggle')}
        onClick={() => setOpen(!open)}
      >
        <Icon icon="chat-sparkles" />
        <span className={cx('Chat-thinking-label')}>
          {streaming
            ? '思考中…'
            : duration > 0
            ? `思考过程 · ${duration}s`
            : '思考过程'}
        </span>
        <Icon icon="caret" className={cx('Chat-thinking-caret')} />
      </button>
      {open ? (
        <div className={cx('Chat-thinking-body')}>{message.content}</div>
      ) : null}
    </div>
  );
}

/**
 * 工具调用:单行步骤(图标+名称+状态+摘要),点击整行展开参数/结果。
 */
function ToolRow({
  message,
  classnames: cx
}: {
  message: ChatMessage;
  classnames: ClassNamesFn;
}) {
  const toolCall = message.toolCall!;
  const running = toolCall.state === 'running';
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(toolCall.args || toolCall.result);

  /** 结果摘要:清洗 JSON 花括号/引号,给人类可读的一行(对标 ChatGPT 的步骤摘要) */
  const resultSummary = toolCall.result
    ? toolCall.result
        .replace(/^\s*\{|\}\s*$/g, '')
        .replace(/"/g, '')
        .replace(/,/g, '·')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60)
    : '';

  return (
    <div className={cx('Chat-tool', `is-${toolCall.state}`)}>
      <button
        type="button"
        className={cx('Chat-tool-row')}
        onClick={() => hasDetail && setOpen(!open)}
      >
        <span className={cx('Chat-tool-icon')}>
          <Icon icon={toolIconOf(toolCall.name)} />
        </span>
        <span className={cx('Chat-tool-name')}>{toolCall.name}</span>
        {running ? (
          <span className={cx('Chat-tool-state')}>
            <Icon icon="loading-outline" />
            {toolCall.args ? '执行中' : '调用中'}
          </span>
        ) : toolCall.state === 'error' ? (
          <span className={cx('Chat-tool-state', 'is-error')}>失败</span>
        ) : resultSummary ? (
          <span className={cx('Chat-tool-state', 'is-summary')}>
            {resultSummary}
            {toolCall.result && toolCall.result.length > 60 ? '…' : ''}
          </span>
        ) : (
          <span className={cx('Chat-tool-state', 'is-summary')}>完成</span>
        )}
        {hasDetail ? (
          <Icon icon="caret" className={cx('Chat-tool-caret')} />
        ) : null}
      </button>
      {open ? (
        <div className={cx('Chat-tool-detail')}>
          {toolCall.args ? (
            <div className={cx('Chat-tool-section')}>
              <div className={cx('Chat-tool-section-title')}>参数</div>
              <pre>{toolCall.args}</pre>
            </div>
          ) : null}
          {toolCall.result ? (
            <div className={cx('Chat-tool-section')}>
              <div className={cx('Chat-tool-section-title')}>结果</div>
              <pre>{toolCall.result}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 附件缩略图:用户消息携带的图片预览网格。
 * 点击在新标签页打开原图(dataURL 可直接预览),避免组件引入
 * 图片查看器依赖。
 */
function AttachmentList({
  message,
  classnames: cx
}: {
  message: ChatMessage;
  classnames: ClassNamesFn;
}) {
  if (!message.attachments?.length) {
    return null;
  }
  return (
    <div className={cx('Chat-attachments')}>
      {message.attachments.map(att => (
        <img
          key={att.id}
          className={cx('Chat-attachment')}
          src={att.url}
          alt={att.name}
          title={att.name}
          onClick={() => window.open(att.url, '_blank')}
        />
      ))}
    </div>
  );
}

/**
 * 渲染单条消息。
 *
 * @param props.message UI 消息模型(kind 决定渲染分支)
 * @param props.mode 气泡模式
 * @param props.roleMeta 该角色的名称/头像
 * @param props.canRegenerate 最后一条助手文本消息,显示重新生成
 * @param props.onRegenerate 重新生成(重发最后一轮)
 */
export default function ChatMessageView(props: ChatMessageProps) {
  const {
    message,
    mode = 'bubble',
    roleMeta,
    showAvatar = true,
    canRegenerate,
    onRegenerate,
    classnames: cx
  } = props;
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  const handleCopy = useCallback(() => {
    copyText(message.content).then(() => {
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    });
  }, [message.content]);

  const isUser = message.role === 'user';
  const isAssistant = message.role === 'assistant';
  const hasBubble = mode === 'bubble' || (mode === 'userBubble' && isUser);
  const displayName = roleMeta?.name;
  const avatar = roleMeta?.avatar;

  const body =
    message.kind === 'tool' && message.toolCall ? (
      <ToolRow message={message} classnames={cx} />
    ) : message.kind === 'thinking' ? (
      <ThinkingRow message={message} classnames={cx} />
    ) : message.status === 'loading' ? (
      <ChatLoading classnames={cx} />
    ) : (
      <>
        <Markdown content={message.content} options={{linkify: true}} />
        {isUser ? <AttachmentList message={message} classnames={cx} /> : null}
        {message.status === 'error' && message.error ? (
          <div className={cx('Chat-error')}>
            <span>{message.error}</span>
            {onRegenerate ? (
              <button
                type="button"
                className={cx('Chat-error-retry')}
                onClick={onRegenerate}
              >
                <Icon icon="chat-redo" />
                重试
              </button>
            ) : null}
          </div>
        ) : null}
      </>
    );

  return (
    <div
      className={cx(
        'Chat-item',
        isUser ? 'is-user' : 'is-assistant',
        hasBubble && 'is-bubble',
        message.status === 'streaming' && 'is-streaming',
        message.status === 'error' && 'is-error'
      )}
    >
      {/* 头像:turn 首条渲染真实头像,后续条目空占位保持缩进对齐 */}
      <div className={cx('Chat-avatar', !showAvatar && 'is-placeholder')}>
        {showAvatar ? (
          avatar ? (
            <img src={avatar} alt={displayName || ''} />
          ) : displayName ? (
            displayName.slice(0, 1)
          ) : isUser ? (
            <Icon icon="role" />
          ) : (
            <Icon icon="chat-sparkles" />
          )
        ) : null}
      </div>
      <div className={cx('Chat-item-main')}>
        {displayName && !isUser && showAvatar ? (
          <div className={cx('Chat-item-name')}>{displayName}</div>
        ) : null}
        <div className={cx('Chat-bubble')}>{body}</div>
        {isAssistant &&
        message.kind === 'text' &&
        message.status === 'complete' &&
        message.content ? (
          <div className={cx('Chat-actions')}>
            <button
              type="button"
              className={cx('Chat-action')}
              onClick={handleCopy}
              title="复制"
            >
              <Icon icon={copied ? 'check' : 'copy'} />
            </button>
            {canRegenerate && onRegenerate ? (
              <button
                type="button"
                className={cx('Chat-action')}
                onClick={onRegenerate}
                title="重新生成"
              >
                <Icon icon="chat-redo" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
