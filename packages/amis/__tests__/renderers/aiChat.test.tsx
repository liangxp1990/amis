/**
 * 组件名称:ai-chat 渲染器
 * 单测内容:
 * 1. welcome / hints 渲染
 * 2. 点击 hint 发送 → env.aguiFetcher 被调用且收到正确 RunAgentInput
 * 3. SSE 事件流 → 流式 markdown 渲染 / 完成态
 * 4. 工具调用卡片渲染
 * 5. RUN_ERROR → 错误条展示
 * 6. 手动输入并发送
 */
import {render, cleanup, fireEvent, waitFor} from '@testing-library/react';
import '../../src';
import {render as amisRender, clearStoresCache} from '../../src';
import {makeEnv} from '../helper';
import type {AguiEvent, AguiFetcher, RunAgentInput} from 'amis-core';

/** 可编程事件剧本:fetcher 调用时按序推送 */
let script: AguiEvent[] = [];
let lastRequest: {endpoint: string; input: RunAgentInput} | undefined;

const mockFetcher: AguiFetcher = (endpoint, input, callbacks) => {
  lastRequest = {endpoint, input};
  const events = script;
  setTimeout(() => {
    events.forEach(event => callbacks.onEvent(event));
    callbacks.onDone();
  }, 0);
  return {abort: () => {}};
};

function setup(schema: any = {}, data?: any) {
  return render(
    amisRender(
      {type: 'ai-chat', endpoint: '/amis-agent/chat', ...schema},
      data ? {data} : {},
      makeEnv({aguiFetcher: mockFetcher})
    )
  );
}

beforeEach(() => {
  script = [];
  lastRequest = undefined;
});

afterEach(() => {
  cleanup();
  clearStoresCache();
});

test('Renderer:ai-chat 渲染 welcome 与 hints', () => {
  const {container, getByText} = setup({
    welcome: '你好,我是助手',
    hints: ['生成周报', '总结数据']
  });
  expect(getByText('生成周报')).toBeInTheDocument();
  expect(getByText('总结数据')).toBeInTheDocument();
  // welcome 经 markdown 渲染
  expect(container.textContent).toContain('你好,我是助手');
});

test('Renderer:ai-chat 点击 hint 发送并渲染流式回复', async () => {
  script = [
    {type: 'RUN_STARTED'},
    {type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant'},
    {type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: '回复的'},
    {type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: '**加粗**内容'},
    {type: 'TEXT_MESSAGE_END', messageId: 'a1'},
    {type: 'RUN_FINISHED'}
  ];
  const {container, getByText} = setup({hints: ['查天气']});

  fireEvent.click(getByText('查天气'));

  await waitFor(() => {
    // markdown 渲染出加粗标签
    expect(container.querySelector('.markdown-body strong')?.textContent).toBe(
      '加粗'
    );
  });
  // fetcher 收到正确的端点与消息历史
  expect(lastRequest?.endpoint).toBe('/amis-agent/chat');
  expect(lastRequest?.input.messages).toEqual([
    {id: expect.any(String), role: 'user', content: '查天气'}
  ]);
  expect(lastRequest?.input.threadId).toEqual(expect.any(String));
});

test('Renderer:ai-chat 工具调用卡片渲染', async () => {
  script = [
    {type: 'RUN_STARTED'},
    {type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'weather'},
    {type: 'TOOL_CALL_ARGS', toolCallId: 'tc1', delta: '{"city":"北京"}'},
    {type: 'TOOL_CALL_RESULT', toolCallId: 'tc1', content: {temp: 26}},
    {type: 'RUN_FINISHED'}
  ];
  const {container, getByText} = setup({hints: ['查天气']});
  fireEvent.click(getByText('查天气'));

  await waitFor(() => {
    expect(getByText('weather')).toBeInTheDocument();
  });
  // 结果摘要显示在单行步骤上
  expect(container.textContent).toContain('temp');
  // 点击行展开参数详情
  fireEvent.click(getByText('weather'));
  await waitFor(() => {
    expect(container.textContent).toContain('北京');
  });
});

test('Renderer:ai-chat RUN_ERROR 展示错误条', async () => {
  script = [
    {type: 'RUN_STARTED'},
    {type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant'},
    {type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: '部分'},
    {type: 'RUN_ERROR', message: 'LLM 超时'}
  ];
  const {container, getByText} = setup({hints: ['你好']});
  fireEvent.click(getByText('你好'));

  await waitFor(() => {
    expect(container.querySelector('.cxd-Chat-error')?.textContent).toContain(
      'LLM 超时'
    );
    // 错误条提供重试入口
    expect(
      container.querySelector('.cxd-Chat-error-retry')
    ).toBeInTheDocument();
  });
});

test('Renderer:ai-chat 输入框输入并发送', async () => {
  script = [
    {type: 'RUN_STARTED'},
    {type: 'TEXT_MESSAGE_START', messageId: 'a1', role: 'assistant'},
    {type: 'TEXT_MESSAGE_CONTENT', messageId: 'a1', delta: '收到'},
    {type: 'RUN_FINISHED'}
  ];
  const {container} = setup();

  const textarea = container.querySelector(
    '.cxd-Chat-input-textarea'
  ) as HTMLTextAreaElement;
  fireEvent.change(textarea, {target: {value: '在吗'}});
  fireEvent.keyDown(textarea, {key: 'Enter'});

  await waitFor(() => {
    expect(container.textContent).toContain('收到');
  });
  expect(lastRequest?.input.messages).toEqual([
    {id: expect.any(String), role: 'user', content: '在吗'}
  ]);
});

test('Renderer:ai-chat agentContext 数据映射进 RunAgentInput', async () => {
  script = [{type: 'RUN_STARTED'}, {type: 'RUN_FINISHED'}];
  const {getByText} = setup(
    {
      hints: ['hi'],
      agentContext: {pageName: '${pageName}', fixed: 'x'}
    },
    {pageName: '首页'}
  );

  fireEvent.click(getByText('hi'));
  await waitFor(() => {
    expect(lastRequest?.input.context).toEqual({pageName: '首页', fixed: 'x'});
  });
});

test('Renderer:ai-chat agentContext 兼容编辑器键值数组格式', async () => {
  script = [{type: 'RUN_STARTED'}, {type: 'RUN_FINISHED'}];
  const {getByText} = setup(
    {
      hints: ['hi'],
      agentContext: [
        {key: 'pageName', value: '${pageName}'},
        {key: 'fixed', value: 'x'},
        {key: '', value: 'ignored'}
      ]
    },
    {pageName: '首页'}
  );

  fireEvent.click(getByText('hi'));
  await waitFor(() => {
    expect(lastRequest?.input.context).toEqual({pageName: '首页', fixed: 'x'});
  });
});

/**
 * 附件多模态:
 * 7. 默认不渲染附件按钮;enableAttachment 开启后渲染
 * 8. 选择图片 + 输入文本发送 → RunAgentInput 最后一条消息为类型化块数组
 * 9. 纯附件(无文本)可发送,不产生空 text 块
 */
test('Renderer:ai-chat 附件按钮随 enableAttachment 开关', () => {
  const {container: def} = setup();
  expect(def.querySelector('.cxd-Chat-input-attach')).toBeNull();

  const {container} = setup({enableAttachment: true});
  expect(container.querySelector('.cxd-Chat-input-attach')).not.toBeNull();
  const fileInput = container.querySelector(
    '.cxd-Chat-input-file'
  ) as HTMLInputElement;
  expect(fileInput).not.toBeNull();
  expect(fileInput.getAttribute('accept')).toBe('image/*');
});

test('Renderer:ai-chat 图文混发组装多模态 content', async () => {
  const {container, getByText} = setup({enableAttachment: true});
  const file = new File(['fake-png-bytes'], 'chart.png', {type: 'image/png'});
  fireEvent.change(container.querySelector('.cxd-Chat-input-file')!, {
    target: {files: [file]}
  });
  // FileReader 异步读取,等待 chip 出现
  await waitFor(() =>
    expect(container.querySelector('.cxd-Chat-input-attachment')).not.toBeNull()
  );

  fireEvent.change(container.querySelector('.cxd-Chat-input-textarea')!, {
    target: {value: '这是什么图'}
  });
  fireEvent.click(container.querySelector('.cxd-Chat-input-btn')!);

  await waitFor(() => expect(lastRequest).toBeDefined());
  const last = lastRequest!.input.messages[
    lastRequest!.input.messages.length - 1
  ];
  expect(last.role).toBe('user');
  const blocks = last.content as any[];
  expect(Array.isArray(blocks)).toBe(true);
  expect(blocks[0]).toEqual({type: 'text', text: '这是什么图'});
  expect(blocks[1]?.type).toBe('image');
  expect(blocks[1]?.source?.type).toBe('data');
  expect(blocks[1]?.source?.mimeType).toBe('image/png');
  expect(typeof blocks[1]?.source?.value).toBe('string');
  // 发送后 chips 清空
  expect(container.querySelector('.cxd-Chat-input-attachment')).toBeNull();
});

test('Renderer:ai-chat 纯附件消息可发送且无空 text 块', async () => {
  const {container} = setup({enableAttachment: true});
  const file = new File(['x'], 'a.jpg', {type: 'image/jpeg'});
  fireEvent.change(container.querySelector('.cxd-Chat-input-file')!, {
    target: {files: [file]}
  });
  await waitFor(() =>
    expect(container.querySelector('.cxd-Chat-input-attachment')).not.toBeNull()
  );
  // 附件就位后发送按钮应可用(无文本)
  const sendBtn = container.querySelector(
    '.cxd-Chat-input-btn'
  ) as HTMLButtonElement;
  expect(sendBtn.disabled).toBe(false);
  fireEvent.click(sendBtn);

  await waitFor(() => expect(lastRequest).toBeDefined());
  const last = lastRequest!.input.messages[
    lastRequest!.input.messages.length - 1
  ];
  const blocks = last.content as any[];
  expect(blocks.filter((b: any) => b.type === 'text')).toHaveLength(0);
  expect(blocks[0]?.type).toBe('image');
});
