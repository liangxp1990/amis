/**
 * @file 聊天输入区:一体化胶囊容器(对齐 Gemini/ChatGPT 交互形态)。
 * textarea 与操作按钮同容器,按钮为单按钮三态:
 * 禁用(空输入/禁用) → 激活(可发送) → 停止(生成中,可中断),状态真实可点。
 */
import React, {useCallback, useRef, useState} from 'react';
import type {ClassNamesFn} from 'amis-core';
import {Icon} from '../icons';

export interface ChatInputProps {
  /** 一次 run 进行中(按钮切换为停止,或按配置禁用) */
  running?: boolean;
  disabled?: boolean;
  placeholder?: string;
  /** 发送快捷键,默认 enter(另一个方向为换行) */
  sendHotKey?: 'enter' | 'shift+enter';
  /** 生成中是否提供停止能力;false 时按钮保持禁用发送态 */
  showStop?: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  classnames: ClassNamesFn;
}

/**
 * 输入区组件(非受控,发送后自动清空)。
 *
 * @param props.onSend 文本非空且空闲时触发
 * @param props.onStop 生成中且 showStop 未关闭时,点击停止按钮触发
 */
export default function ChatInput(props: ChatInputProps) {
  const {
    running,
    disabled,
    placeholder = '输入消息…',
    sendHotKey = 'enter',
    showStop = true,
    onSend,
    onStop,
    classnames: cx
  } = props;
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasText = value.trim().length > 0;
  const isStop = !!running && showStop !== false;
  const btnDisabled = isStop ? false : !hasText || !!running || !!disabled;

  /** 自适应高度:内容变化时重算,受 CSS max-height 限制 */
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text || running || disabled) {
      return;
    }
    onSend(text);
    setValue('');
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
    }
  }, [value, running, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const enterAlone =
        e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing;
      const shiftEnter = e.key === 'Enter' && e.shiftKey;
      const shouldSend = sendHotKey === 'shift+enter' ? shiftEnter : enterAlone;
      if (shouldSend) {
        e.preventDefault();
        submit();
      }
    },
    [sendHotKey, submit]
  );

  const handleBtnClick = useCallback(() => {
    if (isStop) {
      onStop();
    } else {
      submit();
    }
  }, [isStop, onStop, submit]);

  return (
    <div className={cx('Chat-input', running && 'is-running')}>
      <textarea
        ref={textareaRef}
        className={cx('Chat-input-textarea')}
        value={value}
        rows={1}
        disabled={disabled}
        placeholder={placeholder}
        onChange={e => {
          setValue(e.target.value);
          resize();
        }}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className={cx(
          'Chat-input-btn',
          isStop ? 'is-stop' : 'is-send',
          !btnDisabled && 'is-active'
        )}
        disabled={btnDisabled}
        onClick={handleBtnClick}
        aria-label={isStop ? '停止生成' : '发送消息'}
        title={isStop ? '停止生成' : '发送'}
      >
        <Icon icon={isStop ? 'chat-stop' : 'chat-send'} />
      </button>
    </div>
  );
}
