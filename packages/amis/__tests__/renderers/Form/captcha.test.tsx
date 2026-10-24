/**
 * 组件名称：Captcha 行为验证码
 * 单测内容：
 * 1. 基础渲染：embed 滑动拼图模式加载验证码图片
 * 2. 滑动拼图校验成功：pointJson 坐标换算正确（620 基准）、写入表单值
 * 3. 校验失败：进入失败态并自动刷新
 * 4. 点选文字：点满字数提交、成功态展示
 * 5. 滑块曲线：位移映射为曲线控制点 x（310 基准）并提交
 * 6. 获取失败（repCode 6201）：展示错误与重试
 *
 * 注意：env.fetcher 会被 factory 的 wrapFetcher 包装成单 config 参数
 * （POST 数据在 config.data），且响应要经多个异步 hop 才 setState——
 * mock 按单参数取数、断言一律 waitFor 具体界面状态。
 */
import {render, cleanup, fireEvent, waitFor} from '@testing-library/react';
import '../../../src';
import {render as amisRender} from '../../../src';
import {makeEnv, wait} from '../../helper';
import {clearStoresCache} from '../../../src';
import {captchaAesEncrypt} from '../../../src/renderers/Form/CaptchaAes';

// 1x1 透明 PNG
const IMG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const IMG_SRC = `data:image/png;base64,${IMG}`;
const KEY = 'abcdef1234567890';
/** curveSlider mock 用的曲线参数（与官方 demo 同尺寸） */
const CURVE_PARAMS = {
  startX: 40,
  endX: 270,
  topY: 12,
  bottomY: 235,
  ctrlXMin: 62,
  ctrlXMax: 248,
  imgWidth: 310,
  imgHeight: 155
};

afterEach(() => {
  cleanup();
  clearStoresCache();
});

// jsdom 不计算布局，offsetWidth/offsetHeight 恒为 0，mock 成默认展示尺寸
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return 310;
    }
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return 155;
    }
  });
});

/**
 * 构造 captcha mock fetcher（wrapFetcher 包装后为单 config 参数，
 * POST 请求体在 config.data）。
 * @param checkOk check 是否通过
 * @param calls 记录 check 请求体的数组
 * @returns fetcher mock 函数
 */
function makeFetcher(checkOk: boolean, calls: any[] = []) {
  return jest.fn().mockImplementation((config: any) => {
    const url = typeof config === 'string' ? config : config?.url || '';
    const data = typeof config === 'object' ? config?.data ?? config?.body : undefined;
    if (url.includes('/captcha/get')) {
      const isCurve = data?.captchaType === 'curveSlider';
      return Promise.resolve({
        status: 200,
        headers: {},
        data: {
          repCode: '0000',
          repData: {
            originalImageBase64: IMG,
            // curveSlider 协议：jigsawImageBase64 装的是曲线参数 JSON
            jigsawImageBase64: isCurve ? JSON.stringify(CURVE_PARAMS) : IMG,
            token: 'tok-1',
            secretKey: KEY,
            wordList: ['A', 'B', 'C']
          }
        }
      });
    }
    if (url.includes('/captcha/check')) {
      calls.push(data);
      return Promise.resolve(
        checkOk
          ? {status: 200, headers: {}, data: {repCode: '0000', repData: {result: true}}}
          : {status: 200, headers: {}, data: {repCode: '6111', repMsg: '验证失败，请重试'}}
      );
    }
    return Promise.resolve({status: 200, headers: {}, data: {}});
  });
}

const schema = (captchaType?: string) => ({
  type: 'form',
  body: [
    {
      type: 'captcha',
      name: 'captcha',
      label: '验证码',
      getApi: 'post:/api/mock2/captcha/get',
      checkApi: 'post:/api/mock2/captcha/check',
      ...(captchaType ? {captchaType} : {})
    }
  ]
});

/**
 * 等待拼图类验证码就绪（图片真实加载完成后才允许交互，规避 setState 异步竞态）。
 * @param container 容器
 * @returns void
 */
async function waitSliderReady(container: HTMLElement) {
  await waitFor(() =>
    expect(container.querySelector('.cxd-CaptchaControl-img')?.getAttribute('src')).toBe(
      IMG_SRC
    )
  );
}

/**
 * 模拟一次滑块拖动（mouse 事件，jsdom 的 PointerEvent 构造不可靠）。
 * @param container 容器
 * @param distance 位移 px
 * @returns void
 */
function drag(container: HTMLElement, distance: number) {
  const handle = container.querySelector(
    '.cxd-CaptchaControl-sliderHandle'
  ) as HTMLElement;
  fireEvent.mouseDown(handle, {clientX: 100});
  fireEvent.mouseMove(document, {clientX: 100 + distance});
  fireEvent.mouseUp(document);
}

test('Renderer:captcha 基础渲染', async () => {
  const fetcher = makeFetcher(true);
  const {container} = render(amisRender(schema(), {}, makeEnv({fetcher})));
  await waitSliderReady(container);

  expect(container.querySelector('.cxd-CaptchaControl')).toBeInTheDocument();
  expect(
    container.querySelector('.cxd-CaptchaControl-sliderHandle')
  ).toBeInTheDocument();
  expect(container.querySelector('.cxd-CaptchaControl-piece')).toBeInTheDocument();
});

test('Renderer:captcha 滑动拼图校验成功', async () => {
  const calls: any[] = [];
  const fetcher = makeFetcher(true, calls);
  const {container} = render(amisRender(schema(), {}, makeEnv({fetcher})));
  await waitSliderReady(container);

  drag(container, 80);
  await waitFor(() => expect(fetcher).toBeCalledTimes(2));
  // x = 80px * 620 / 310 = 160，pointJson 用 secretKey 加密
  const pointJson = captchaAesEncrypt(JSON.stringify({x: 160, y: 5.0}), KEY);
  expect(calls[0]).toMatchObject({
    captchaType: 'blockPuzzle',
    pointJson,
    token: 'tok-1'
  });
  await waitFor(() =>
    expect(
      container.querySelector('.cxd-CaptchaControl-slider')
    ).toHaveClass('is--success')
  );
  expect(container).toHaveTextContent('验证成功');
});

test('Renderer:captcha 校验失败自动刷新', async () => {
  const calls: any[] = [];
  const fetcher = makeFetcher(false, calls);
  const {container} = render(amisRender(schema(), {}, makeEnv({fetcher})));
  await waitSliderReady(container);

  drag(container, 40);
  await waitFor(() =>
    expect(
      container.querySelector('.cxd-CaptchaControl-slider')
    ).toHaveClass('is--fail')
  );
  // 1s 后自动刷新重新 get
  await waitFor(() => expect(fetcher).toBeCalledTimes(3), {timeout: 3000});
  await waitFor(() =>
    expect(
      container.querySelector('.cxd-CaptchaControl-slider')
    ).not.toHaveClass('is--fail')
  );
});

test('Renderer:captcha 点选文字', async () => {
  const calls: any[] = [];
  const fetcher = makeFetcher(true, calls);
  const {container} = render(
    amisRender(schema('clickWord'), {}, makeEnv({fetcher}))
  );
  // 等 wordList 渲染出来（数据依赖信号，rep 就绪的可靠标志）
  await waitFor(() => expect(container).toHaveTextContent('A'));
  const img = container.querySelector('.cxd-CaptchaControl-img') as HTMLElement;

  const click = (x: number, y: number) => {
    const evt = new MouseEvent('click', {bubbles: true});
    Object.defineProperty(evt, 'offsetX', {value: x});
    Object.defineProperty(evt, 'offsetY', {value: y});
    fireEvent(img, evt);
  };
  click(50, 30);
  click(120, 100);
  click(200, 60);

  await waitFor(() => expect(fetcher).toBeCalledTimes(2));
  // 显示尺寸即基准尺寸，坐标不缩放
  const pointJson = captchaAesEncrypt(
    JSON.stringify([
      {x: 50, y: 30},
      {x: 120, y: 100},
      {x: 200, y: 60}
    ]),
    KEY
  );
  expect(calls[0]).toMatchObject({captchaType: 'clickWord', pointJson});
  // 成功结果层（图片区中央绿圆对勾 + 文案，对齐腾讯）
  await waitFor(() =>
    expect(
      container.querySelector('.cxd-CaptchaControl-resultOverlay.is--success')
    ).toBeInTheDocument()
  );
  expect(container).toHaveTextContent('验证成功');
  // 已点标记
  expect(container.querySelectorAll('.cxd-CaptchaControl-marker').length).toBe(3);
});

test('Renderer:captcha 滑块曲线', async () => {
  const calls: any[] = [];
  const fetcher = makeFetcher(true, calls);
  const {container} = render(
    amisRender(schema('curveSlider'), {}, makeEnv({fetcher}))
  );
  // 曲线参数无静态 DOM 信号，等 get 响应链路（多个异步 hop）落定再交互
  await waitFor(() => expect(fetcher).toBeCalledTimes(1));
  await wait(300);
  expect(container).toHaveTextContent('拖动滑块使曲线重合');
  expect(container.querySelector('.cxd-CaptchaControl-canvas')).toBeInTheDocument();

  drag(container, 80);
  await waitFor(() => expect(fetcher).toBeCalledTimes(2));
  // scaled = 80 * 310 / 310 = 80；ratio = 80 / (310-50)；
  // ctrlX = round(62 + ratio * (248 - 62)) = 119
  const pointJson = captchaAesEncrypt(JSON.stringify({x: 119, y: 0}), KEY);
  expect(calls[0]).toMatchObject({
    captchaType: 'curveSlider',
    pointJson,
    token: 'tok-1'
  });
  await waitFor(() =>
    expect(
      container.querySelector('.cxd-CaptchaControl-slider')
    ).toHaveClass('is--success')
  );
});

test('Renderer:captcha 获取失败展示错误', async () => {
  const fetcher = jest.fn().mockImplementation(() =>
    Promise.resolve({
      status: 200,
      headers: {},
      data: {repCode: '6201', repMsg: '接口请求次数超出限制'}
    })
  );
  const {container} = render(amisRender(schema(), {}, makeEnv({fetcher})));
  await waitFor(() =>
    expect(container.querySelector('.cxd-CaptchaControl-error')).toBeInTheDocument()
  );
  expect(container).toHaveTextContent('接口请求次数超出限制');
  expect(container).toHaveTextContent('重试');
});

test('Renderer:captcha 组件动作唤起弹出验证', async () => {
  const fetcher = makeFetcher(true);
  const {container, getByText} = render(
    amisRender(
      {
        type: 'page',
        body: {
          type: 'form',
          body: [
            {
              type: 'captcha',
              id: 'cap1',
              name: 'captcha',
              label: '验证码',
              displayMode: 'popup',
              hideTrigger: true,
              getApi: 'post:/api/mock2/captcha/get',
              checkApi: 'post:/api/mock2/captcha/check'
            },
            {
              type: 'button',
              label: '发送短信',
              onEvent: {
                click: {
                  actions: [
                    // v6 组件动作写法：actionType 直接写动作名 + componentId 定向
                    {actionType: 'open', componentId: 'cap1'}
                  ]
                }
              }
            }
          ]
        }
      },
      {},
      makeEnv({fetcher})
    )
  );
  // 隐藏触发按钮：不渲染自带 Button
  expect(container.querySelector('.cxd-CaptchaControl-trigger')).toBeNull();
  // 弹出模式未打开时不加载验证码
  await wait(200);
  expect(fetcher).toBeCalledTimes(0);
  // 外部按钮通过组件动作唤起
  fireEvent.click(getByText('发送短信'));
  await waitFor(() =>
    expect(container.querySelector('.cxd-CaptchaControl-pop')).toBeInTheDocument()
  );
  await waitFor(() => expect(fetcher).toBeCalledTimes(1));
});
