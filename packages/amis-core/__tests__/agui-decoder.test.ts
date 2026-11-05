/**
 * 组件名称:AG-UI SSE 解码器
 * 单测内容:
 * 1. 基础单事件解码
 * 2. 跨 chunk 半包
 * 3. 一 chunk 多事件
 * 4. 心跳注释行 / 非 JSON data / 缺 type 字段容错
 * 5. \r\n 分隔与多行 data 拼接
 */
import {createSSEDecoder} from '../src/ai/decoder';

test('agui-decoder: 基础单事件', () => {
  const decoder = createSSEDecoder();
  expect(
    decoder.push('data: {"type":"RUN_STARTED","threadId":"t1"}\n\n')
  ).toEqual([{type: 'RUN_STARTED', threadId: 't1'}]);
});

test('agui-decoder: 跨 chunk 半包补齐', () => {
  const decoder = createSSEDecoder();
  expect(decoder.push('data: {"type":"TEXT_MESSAGE_CON')).toEqual([]);
  expect(decoder.push('TENT","messageId":"m1","delta":"你"}\n\n')).toEqual([
    {type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: '你'}
  ]);
});

test('agui-decoder: 一个 chunk 多事件', () => {
  const decoder = createSSEDecoder();
  const events = decoder.push(
    'data: {"type":"RUN_STARTED"}\n\ndata: {"type":"TEXT_MESSAGE_START","messageId":"m1","role":"assistant"}\n\n'
  );
  expect(events).toHaveLength(2);
  expect(events[0].type).toBe('RUN_STARTED');
  expect(events[1].type).toBe('TEXT_MESSAGE_START');
});

test('agui-decoder: 心跳注释行与非 JSON 容错', () => {
  const decoder = createSSEDecoder();
  // ": ping" 心跳 + 非 JSON data + 缺 type 字段的 JSON
  const events = decoder.push(
    ': ping\n\ndata: not-json\n\ndata: {"foo":1}\n\ndata: {"type":"RUN_FINISHED"}\n\n'
  );
  expect(events).toEqual([{type: 'RUN_FINISHED'}]);
});

test('agui-decoder: \\r\\n 分隔与多行 data 拼接', () => {
  const decoder = createSSEDecoder();
  // 部分 SDK 会把长 JSON 拆成多行 data
  const events = decoder.push(
    'data: {"type":"CUSTOM",\r\ndata: "name":"x"}\r\n\r\n'
  );
  expect(events).toEqual([{type: 'CUSTOM', name: 'x'}]);
});
