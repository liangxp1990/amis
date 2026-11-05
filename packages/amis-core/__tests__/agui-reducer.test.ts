/**
 * 组件名称:AG-UI 事件归并 reducer
 * 单测内容:
 * 1. 一次完整 run(文本流式 → finish)
 * 2. 工具调用卡片状态机(START/ARGS/RESULT)
 * 3. 思考过程条目
 * 4. STATE_SNAPSHOT / STATE_DELTA(JSON Patch)
 * 5. RUN_ERROR 挂错误
 * 6. STOP 本地停止保留已生成内容
 * 7. MESSAGES_SNAPSHOT 整体替换
 * 8. applyJsonPatch 不可变性
 */
import {
  applyJsonPatch,
  chatReducer,
  initialChatState,
  type ChatAction
} from '../src/ai/reducer';
import type {AguiEvent} from '../src/ai/types';

function run(state = initialChatState, ...actions: ChatAction[]) {
  return actions.reduce(chatReducer, state);
}

function ev(event: AguiEvent): ChatAction {
  return {type: 'AGUI_EVENT', event};
}

test('reducer: 完整文本 run 流式归并', () => {
  const final = run(
    initialChatState,
    {type: 'SEND', id: 'u1', content: '你好'},
    ev({type: 'RUN_STARTED'}),
    ev({type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant'}),
    ev({type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: '你'}),
    ev({type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: '好!'}),
    ev({type: 'TEXT_MESSAGE_END', messageId: 'a1'}),
    ev({type: 'RUN_FINISHED'})
  );
  expect(final.running).toBe(false);
  // user 消息 + 占位被复用为 assistant 流式消息
  expect(final.messages).toHaveLength(2);
  expect(final.messages[1]).toMatchObject({
    id: 'a1',
    role: 'assistant',
    content: '你好!',
    status: 'complete'
  });
});

test('reducer: 工具调用状态机', () => {
  const state = run(
    initialChatState,
    {type: 'SEND', id: 'u1', content: '查天气'},
    ev({type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'weather'}),
    ev({type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"city":'}),
    ev({type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '"北京"}'}),
    ev({type: 'TOOL_CALL_RESULT', toolCallId: 'tc1', content: {temp: 26}}),
    ev({type: 'RUN_FINISHED'})
  );
  const tool = state.messages.find(m => m.kind === 'tool')!;
  expect(tool.toolCall).toMatchObject({
    id: 'tc1',
    name: 'weather',
    args: '{"city":"北京"}',
    state: 'success',
    result: '{\n  "temp": 26\n}'
  });
  // 无 RESULT 的工具在 RUN_FINISHED 时宽容收尾
  const noResult = run(
    initialChatState,
    ev({type: 'RUN_STARTED'}),
    ev({type: 'TOOL_CALL_START', toolCallId: 'tc2', toolCallName: 'x'}),
    ev({type: 'RUN_FINISHED'})
  );
  expect(
    noResult.messages.find(m => m.kind === 'tool')!.toolCall!.state
  ).toBe('success');
});

test('reducer: 思考过程独立条目', () => {
  const state = run(
    initialChatState,
    ev({type: 'RUN_STARTED'}),
    ev({type: 'THINKING_START', messageId: 'th1'}),
    ev({type: 'THINKING_CONTENT', messageId: 'th1', delta: '先分析…'}),
    ev({type: 'THINKING_END', messageId: 'th1'})
  );
  expect(state.messages[0]).toMatchObject({
    kind: 'thinking',
    content: '先分析…',
    status: 'complete'
  });
});

test('reducer: loading 占位被思考/工具条目复用(不产生 ••• 残留)', () => {
  const state = run(
    initialChatState,
    {type: 'SEND', id: 'u1', content: 'hi'},
    ev({type: 'RUN_STARTED'}),
    ev({type: 'THINKING_START', messageId: 'th1'}),
    ev({type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'w'})
  );
  // user + thinking(由占位复用) + tool(新建),无空占位残留
  expect(state.messages.map(m => `${m.kind}:${m.status}`)).toEqual([
    'text:complete',
    'thinking:streaming',
    'tool:streaming'
  ]);
});

test('reducer: STATE_SNAPSHOT 与 STATE_DELTA', () => {
  let state = run(initialChatState, ev({type: 'STATE_SNAPSHOT', snapshot: {count: 1, tags: ['a']}}));
  expect(state.agentState).toEqual({count: 1, tags: ['a']});
  state = run(state, ev({type: 'STATE_DELTA', delta: [
    {op: 'replace', path: '/count', value: 2},
    {op: 'add', path: '/tags/-', value: 'b'},
    {op: 'remove', path: '/tags/0'}
  ]}));
  expect(state.agentState).toEqual({count: 2, tags: ['b']});
  // 非法 delta 容错
  state = run(state, ev({type: 'STATE_DELTA', delta: 'oops'}));
  expect(state.agentState).toEqual({count: 2, tags: ['b']});
});

test('reducer: RUN_ERROR 挂到流式中的助手消息', () => {
  const state = run(
    initialChatState,
    {type: 'SEND', id: 'u1', content: 'hi'},
    ev({type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant'}),
    ev({type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: '部分内容'}),
    ev({type: 'RUN_ERROR', message: 'LLM 超时'})
  );
  expect(state.running).toBe(false);
  expect(state.messages[1]).toMatchObject({
    status: 'error',
    error: 'LLM 超时',
    content: '部分内容'
  });
});

test('reducer: STOP 保留已生成内容并收尾', () => {
  const state = run(
    initialChatState,
    {type: 'SEND', id: 'u1', content: 'hi'},
    ev({type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant'}),
    ev({type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: '生成中'}),
    {type: 'STOP'}
  );
  expect(state.running).toBe(false);
  expect(state.messages[1]).toMatchObject({content: '生成中', status: 'complete'});
});

test('reducer: MESSAGES_SNAPSHOT 整体替换', () => {
  const state = run(
    initialChatState,
    {type: 'SEND', id: 'u1', content: 'hi'},
    ev({type: 'RUN_STARTED'}),
    ev({type: 'MESSAGES_SNAPSHOT', messages: [
      {id: 'm1', role: 'user', content: '历史1'},
      {id: 'm2', role: 'assistant', content: '历史2'}
    ]})
  );
  expect(state.messages.map(m => m.content)).toEqual(['历史1', '历史2']);
  expect(state.messages.every(m => m.status === 'complete')).toBe(true);
});

test('applyJsonPatch: 不可变与 move', () => {
  const source = {a: {b: 1}, c: [1, 2]};
  const patched = applyJsonPatch(source, [
    {op: 'move', from: '/a/b', path: '/a/d'},
    {op: 'add', path: '/c/-', value: 3}
  ]);
  expect(patched).toEqual({a: {d: 1}, c: [1, 2, 3]});
  // 原对象不被修改
  expect(source).toEqual({a: {b: 1}, c: [1, 2]});
});

test('reducer: 兼容 agentscope 的 REASONING_* 事件命名', () => {
  const state = run(
    initialChatState,
    {type: 'SEND', id: 'u1', content: 'hi'},
    ev({type: 'RUN_STARTED'}),
    ev({type: 'REASONING_MESSAGE_START', messageId: 'rs1'}),
    ev({type: 'REASONING_MESSAGE_CONTENT', messageId: 'rs1', delta: '思考中'}),
    ev({type: 'REASONING_MESSAGE_CHUNK', messageId: 'rs1', delta: '…继续'}),
    ev({type: 'REASONING_MESSAGE_END', messageId: 'rs1'}),
    ev({type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant'}),
    ev({type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: '回答'}),
    ev({type: 'RUN_FINISHED'})
  );
  expect(state.messages[1]).toMatchObject({
    kind: 'thinking',
    content: '思考中…继续',
    status: 'complete'
  });
  expect(state.messages[2]).toMatchObject({kind: 'text', content: '回答'});
});
