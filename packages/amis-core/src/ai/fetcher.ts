/**
 * @file AG-UI 默认 fetcher:POST RunAgentInput,消费 SSE 事件流。
 */
import {createSSEDecoder} from './decoder';
import type {AguiFetchHandle, AguiFetcher} from './types';

/**
 * 内置默认 AG-UI fetcher:原生 fetch + ReadableStream 逐 chunk 解码。
 * 同源携带 cookie;跨域/自定义鉴权场景由宿主通过 `env.aguiFetcher`
 * 或组件 props `fetcher` 覆盖本实现。
 */
export const defaultAguiFetcher: AguiFetcher = (
  endpoint,
  input,
  callbacks
): AguiFetchHandle => {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(input),
        credentials: 'same-origin',
        signal: controller.signal
      });
      if (!response.ok || !response.body) {
        throw new Error(
          `AG-UI 端点请求失败: HTTP ${response.status} ${endpoint}`
        );
      }
      const reader = response.body.getReader();
      const textDecoder = new TextDecoder();
      const sseDecoder = createSSEDecoder();
      for (;;) {
        const {done, value} = await reader.read();
        if (done) {
          break;
        }
        const events = sseDecoder.push(
          textDecoder.decode(value, {stream: true})
        );
        for (const event of events) {
          callbacks.onEvent(event);
        }
      }
      callbacks.onDone();
    } catch (err: any) {
      // 用户主动 abort 不是错误
      if (!controller.signal.aborted) {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  })();

  return {
    abort: () => controller.abort()
  };
};
