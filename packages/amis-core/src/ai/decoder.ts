/**
 * @file SSE 流解码:把字节流 chunk 增量还原为 AG-UI 事件对象。
 */
import type {AguiEvent} from './types';

/** 帧分隔符:空行(兼容 \n 与 \r\n) */
const FRAME_SEP = /\r?\n\r?\n/;

/**
 * 解析单个 SSE 帧,返回事件对象;非 data 帧(心跳注释/纯 event 帧)与
 * 非 JSON data 返回 null。
 *
 * @param frame 不含分隔符的帧文本
 */
function frameToEvent(frame: string): AguiEvent | null {
  const dataLines: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    // 空行与 ":" 开头的注释行(常被用作心跳 keep-alive)忽略
    if (!line || line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('data:')) {
      // 规范允许 "data: x" 冒号后一个可选空格
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    // event:/id:/retry: 字段对 AG-UI 无意义,忽略
  }
  if (!dataLines.length) {
    return null;
  }
  const raw = dataLines.join('\n');
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.type !== 'string') {
      console.warn('[agui] SSE data 缺少 type 字段,已忽略:', raw.slice(0, 120));
      return null;
    }
    return obj as AguiEvent;
  } catch (e) {
    console.warn('[agui] 忽略非 JSON 的 SSE data:', raw.slice(0, 120));
    return null;
  }
}

export interface SSEDecoder {
  /**
   * 送入一段新到达的文本 chunk,返回其中包含的完整事件。
   * 跨 chunk 的半包帧会被缓存在内部,直到补齐为止。
   *
   * @param chunk TextDecoder 以 stream 模式解码出的文本
   * @returns 本次解析出的 0..n 个事件
   */
  push(chunk: string): AguiEvent[];
}

/**
 * 创建 SSE 解码器实例(有状态,每个请求一个)。
 *
 * @example
 * const decoder = createSSEDecoder();
 * decoder.push('data: {"type":"RUN_STARTED"}\n\n'); // => [事件]
 * decoder.push('data: {"type":"TEXT_MES');           // 半包,=> []
 * decoder.push('SAGE_CONTENT","delta":"你"}\n\n');    // 补齐,=> [事件]
 */
export function createSSEDecoder(): SSEDecoder {
  let buffer = '';

  return {
    push(chunk: string): AguiEvent[] {
      buffer += chunk;
      const events: AguiEvent[] = [];
      let match: RegExpExecArray | null;
      // 循环切出所有完整帧,尾巴留在 buffer 等待下个 chunk
      while ((match = FRAME_SEP.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const event = frameToEvent(frame);
        if (event) {
          events.push(event);
        }
      }
      return events;
    }
  };
}
