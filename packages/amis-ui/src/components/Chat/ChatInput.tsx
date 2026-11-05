/**
 * @file 聊天输入区:一体化胶囊容器(对齐 Gemini/ChatGPT 交互形态)。
 * textarea 与操作按钮同容器,按钮为单按钮三态:
 * 禁用(空输入/禁用) → 激活(可发送) → 停止(生成中,可中断),状态真实可点。
 * 可选启用附件:胶囊左下回形针按钮触发文件选择,选中后以 chips
 * 缩略图暂存,随消息一起发送(文本或附件任一非空即可发送)。
 */
import React, {useCallback, useRef, useState} from 'react';
import type {ClassNamesFn} from 'amis-core';
import type {ChatAttachment} from 'amis-core';
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
  /** 是否启用附件按钮(图片等多模态输入),默认不启用 */
  enableAttachment?: boolean;
  /** 文件选择器 accept,默认 image/* */
  attachmentAccept?: string;
  /** 单文件大小上限(MB),默认 5 */
  attachmentMaxSize?: number;
  /** 附件数量上限,默认 9 */
  attachmentMaxCount?: number;
  onSend: (text: string, attachments?: ChatAttachment[]) => void;
  onStop: () => void;
  classnames: ClassNamesFn;
}

/** 默认单文件上限 5MB:base64 直发场景控制请求体体积 */
const DEFAULT_MAX_SIZE_MB = 5;
/** 默认附件数上限,对齐主流对话产品单条消息图片数 */
const DEFAULT_MAX_COUNT = 9;

/**
 * 读取单个文件为 dataURL 附件模型。
 *
 * @param file 用户选择的文件
 * @returns 附件模型(读取失败时抛错由调用方提示)
 */
function readAsAttachment(file: File): Promise<ChatAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        url: String(reader.result)
      });
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * 输入区组件(非受控,发送后自动清空)。
 *
 * @param props.onSend 文本或附件非空且空闲时触发
 * @param props.onStop 生成中且 showStop 未关闭时,点击停止按钮触发
 */
export default function ChatInput(props: ChatInputProps) {
  const {
    running,
    disabled,
    placeholder = '输入消息…',
    sendHotKey = 'enter',
    showStop = true,
    enableAttachment = false,
    attachmentAccept = 'image/*',
    attachmentMaxSize = DEFAULT_MAX_SIZE_MB,
    attachmentMaxCount = DEFAULT_MAX_COUNT,
    onSend,
    onStop,
    classnames: cx
  } = props;
  const [value, setValue] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  /** 附件校验失败的行内提示(限时消失,组件无 toast 依赖) */
  const [attachError, setAttachError] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const hasText = value.trim().length > 0;
  const canSend = hasText || attachments.length > 0;
  const isStop = !!running && showStop !== false;
  const btnDisabled = isStop ? false : !canSend || !!running || !!disabled;

  /** 校验失败提示:展示 3s 后自动消失 */
  const showAttachError = useCallback((msg: string) => {
    setAttachError(msg);
    clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setAttachError(''), 3000);
  }, []);

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
    if ((!text && attachments.length === 0) || running || disabled) {
      return;
    }
    onSend(text, attachments.length > 0 ? attachments : undefined);
    setValue('');
    setAttachments([]);
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
    }
  }, [value, attachments, running, disabled, onSend]);

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

  /** 文件选择:逐个校验大小/数量后读为 dataURL 追加到 chips */
  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) {
        return;
      }
      const maxBytes = attachmentMaxSize * 1024 * 1024;
      const list = Array.from(files);
      for (const file of list) {
        if (file.size > maxBytes) {
          showAttachError(
            `「${file.name}」超过 ${attachmentMaxSize}MB 上限,未添加`
          );
          return;
        }
      }
      if (attachments.length + list.length > attachmentMaxCount) {
        showAttachError(`最多添加 ${attachmentMaxCount} 个附件`);
        return;
      }
      Promise.all(list.map(readAsAttachment))
        .then(added => setAttachments(prev => [...prev, ...added]))
        .catch(err => {
          console.warn('[chat] 附件读取失败:', err);
          showAttachError('附件读取失败,请重试');
        });
    },
    [attachments.length, attachmentMaxSize, attachmentMaxCount, showAttachError]
  );

  /** 删除单个附件 chip */
  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(att => att.id !== id));
  }, []);

  return (
    <div className={cx('Chat-input', running && 'is-running')}>
      {attachments.length > 0 || attachError ? (
        <div className={cx('Chat-input-attachments')}>
          {attachments.map(att => (
            <div key={att.id} className={cx('Chat-input-attachment')}>
              <img src={att.url} alt={att.name} title={att.name} />
              <button
                type="button"
                className={cx('Chat-input-attachment-remove')}
                onClick={() => removeAttachment(att.id)}
                aria-label={`移除附件 ${att.name}`}
              >
                <Icon icon="close-small" />
              </button>
            </div>
          ))}
          {attachError ? (
            <span className={cx('Chat-input-attachment-error')}>
              {attachError}
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={cx('Chat-input-row')}>
        {enableAttachment ? (
          <button
            type="button"
            className={cx('Chat-input-attach', disabled && 'is-disabled')}
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            aria-label="添加附件"
            title="添加附件"
          >
            <Icon icon="chat-attach" />
          </button>
        ) : null}
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
      {enableAttachment ? (
        <input
          ref={fileInputRef}
          type="file"
          className={cx('Chat-input-file')}
          multiple
          accept={attachmentAccept}
          onChange={e => {
            handleFiles(e.target.files);
            // 允许重复选择同一文件
            e.target.value = '';
          }}
        />
      ) : null}
    </div>
  );
}
