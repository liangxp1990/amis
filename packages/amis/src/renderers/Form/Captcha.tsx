/**
 * @file 行为验证码表单项（AJ-Captcha 协议：滑动拼图 / 滑块曲线 / 点选文字）。
 *
 * 协议兼容 anji-plus/captcha（Apache-2.0）后端：
 * - POST {getApi}  {captchaType, clientUid, ts}
 *   → {repCode:'0000', repData:{originalImageBase64, jigsawImageBase64?, token, secretKey, wordList?}}
 *   其中 curveSlider 的 jigsawImageBase64 是曲线参数 JSON（非图片）
 * - POST {checkApi} {captchaType, pointJson(AES), token}
 *   → repCode '0000' 通过
 * - 验证成功产出二次校验凭证 captchaVerification = AES(token + '---' + pointJson原文, secretKey)，
 *   业务后端拿它调 aj-captcha 的 POST /captcha/verify 做最终核验。
 *
 * 坐标协议（以官方实现为准）：
 * - 滑动拼图：x = 滑块位移px * 620 / 显示宽（620 为后端原图基准宽），y 恒为 5.0
 * - 滑块曲线：滑块位移换算到 310 基准后映射为曲线控制点 x（ctrlXMin..ctrlXMax），y 恒为 0
 * - 点选文字：[{x: offsetX * 310 / 显示宽, y: offsetY * 155 / 显示高}, ...]（310x155 基准）
 */
import React from 'react';
import {
  FormItem,
  autobind,
  createObject,
  guid,
  isApiOutdated,
  resolveEventData,
  type ActionObject,
  type AMISApi,
  type FormControlProps
} from 'amis-core';
import {Icon, Button, Spinner} from 'amis-ui';
import {captchaAesEncrypt} from './CaptchaAes';
import {CheckIcon, ShieldCheckIcon, RefreshCwIcon} from './CaptchaIcon';

import type {AMISFormItem} from 'amis-core';

/**
 * Captcha 组件的 Schema 定义。
 * 注释会被 build-schemas 提取到 schema.json，供编辑器提示使用。
 */
export interface AMISCaptchaSchema extends AMISFormItem {
  /** 指定为 captcha 验证码组件 */
  type: 'captcha';

  /**
   * 验证码类型：滑动拼图 / 滑块曲线 / 点选文字
   * @default 'blockPuzzle'
   */
  captchaType?: 'blockPuzzle' | 'curveSlider' | 'clickWord';

  /**
   * 获取验证码图片的接口（AJ-Captcha 协议 /captcha/get）
   * @default 'post:/captcha/get'
   */
  getApi?: AMISApi;

  /**
   * 行为校验接口（AJ-Captcha 协议 /captcha/check）
   * @default 'post:/captcha/check'
   */
  checkApi?: AMISApi;

  /**
   * 展示形态：内嵌（直接渲染）/ 弹出（点击按钮弹出）。
   * 注意不能叫 mode——那是表单布局属性（horizontal/inline/normal）
   * @default 'embed'
   */
  displayMode?: 'embed' | 'popup';

  /**
   * 弹出模式的触发按钮文案
   * @default '点击进行验证'
   */
  actionText?: string;

  /**
   * 隐藏自带触发按钮（配合组件动作 open 由外部按钮触发弹出，如"发送短信"场景）
   * @default false
   */
  hideTrigger?: boolean;

  /**
   * 验证码显示宽度（px），图片按 2:1 等比显示
   * @default 310
   */
  width?: number;
}

export interface CaptchaProps
  extends FormControlProps,
    // 交集键（label/描述/className 类属性等）以 FormControlProps 为准，
    // 避免逐个 Omit AMISFormItem 上的 AMISClassName 类型属性（TS1238）。
    // onChange 直接继承 FormControlProps 的必选声明，勿本地重声明为可选（TS2430）
    Omit<AMISCaptchaSchema, 'type' | 'className' | keyof FormControlProps> {
  value?: any;
}

interface CaptchaRepData {
  originalImageBase64?: string;
  /** blockPuzzle 为拼图条图片；curveSlider 为曲线参数 JSON 字符串 */
  jigsawImageBase64?: string;
  token?: string;
  secretKey?: string;
  wordList?: string[];
}

/** 曲线参数（后端放在 jigsawImageBase64 字段返回的 JSON） */
interface CurveParams {
  startX: number;
  endX: number;
  topY: number;
  bottomY: number;
  ctrlXMin: number;
  ctrlXMax: number;
  imgWidth: number;
  imgHeight: number;
}

interface CaptchaState {
  loading: boolean;
  /** get 接口错误信息（repCode 非 0000，如 6201 请求超限） */
  error: string;
  rep: CaptchaRepData;
  /** 组件交互状态 */
  status: 'ready' | 'dragging' | 'checking' | 'success' | 'fail';
  /** 滑块位移（px，显示坐标系） */
  moveX: number;
  /** 滑块归位动画开关（重置时开启，拖动中关闭） */
  transition: boolean;
  /** 点选模式已点坐标（310x155 基准，含显示用的原始坐标） */
  points: Array<{x: number; y: number; rawX: number; rawY: number}>;
  /** 图片区悬浮提示文案与配色 */
  tipText: string;
  tipStatus: 'success' | 'fail' | '';
  /** 弹出模式是否展开 */
  open: boolean;
  /** 曲线参数（curveSlider） */
  curveParams: CurveParams | null;
  /** 曲线底图加载完成后置，触发重绘 */
  curveReady: boolean;
}

/** 后端原图基准：滑动拼图 620 宽；曲线与点选 310x155 */
const PUZZLE_BASE_WIDTH = 620;
const CLICK_BASE_WIDTH = 310;
const CLICK_BASE_HEIGHT = 155;
/** 滑动拼图小块条（全高）在 620 基准下的宽度 */
const PUZZLE_STRIP_BASE_WIDTH = 94;
/** 曲线模式滑块宽度（与官方 blockSize 一致，用于行程映射） */
const CURVE_BLOCK_WIDTH = 50;

/**
 * 行为验证码控件。
 *
 * 验证成功后把二次校验凭证写入表单数据（name 对应字段），
 * 业务提交时随表单传给后端做 /captcha/verify 核验。
 *
 * 事件：change（值变化，可 preventDefault）、success（验证成功）、fail（验证失败）。
 */
export class CaptchaControl extends React.Component<CaptchaProps, CaptchaState> {
  static defaultProps: Partial<CaptchaProps> = {
    captchaType: 'blockPuzzle',
    displayMode: 'embed',
    actionText: '点击进行验证',
    width: 310
  };

  state: CaptchaState = {
    loading: false,
    error: '',
    rep: {},
    status: 'ready',
    moveX: 0,
    transition: false,
    points: [],
    tipText: '',
    tipStatus: '',
    open: false,
    curveParams: null,
    curveReady: false
  };

  /** 滑轨区域 DOM，用于计算拖动边界 */
  private barRef: React.RefObject<HTMLDivElement> = React.createRef();
  /** 曲线画布 DOM（curveSlider） */
  private canvasRef: React.RefObject<HTMLCanvasElement> = React.createRef();
  /** 曲线底图 Image 对象（curveSlider） */
  private bgImage: HTMLImageElement | null = null;
  /** 拖动会话：按下时的鼠标位置与当时位移 */
  private dragSession: {startClientX: number; startMoveX: number; startTime: number} | null =
    null;
  /** 失败自动刷新 / 成功自动关弹窗的定时器 */
  private timers: Array<ReturnType<typeof setTimeout>> = [];

  componentDidMount() {
    if (this.props.displayMode !== 'popup') {
      this.loadCaptcha();
    }
  }

  componentDidUpdate(prevProps: CaptchaProps, prevState: CaptchaState) {
    const props = this.props;
    // getApi 变化（如 url 带变量重新求值）时重新加载
    if (isApiOutdated(prevProps.getApi, props.getApi, prevProps.data, props.data)) {
      this.loadCaptcha();
    }
    // 外部清空值（表单重置）时恢复初始态
    if (prevProps.value && !props.value && this.state.status === 'success') {
      this.resetInteractiveState();
    }
    // 曲线重绘：底图加载完成 / 拖动位移 / 新一局
    if (
      this.props.captchaType === 'curveSlider' &&
      (prevState.curveReady !== this.state.curveReady ||
        prevState.moveX !== this.state.moveX ||
        prevState.rep !== this.state.rep)
    ) {
      this.drawCurve();
    }
  }

  componentWillUnmount() {
    this.clearTimers();
    this.unbindDragEvents();
  }

  /**
   * 清理所有挂起的定时器（自动刷新/自动关闭弹窗）。
   * @returns void
   */
  clearTimers() {
    this.timers.forEach(t => clearTimeout(t));
    this.timers = [];
  }

  /**
   * 生成并持久化 clientUid（后端限流指纹，官方同样持久化复用）。
   * @returns clientUid 字符串
   */
  getClientUid(): string {
    if (typeof window === 'undefined') {
      return 'captcha-ssr';
    }
    try {
      let uid = window.localStorage.getItem('amis-captcha-client');
      if (!uid) {
        uid = `captcha-${guid()}`;
        window.localStorage.setItem('amis-captcha-client', uid);
      }
      return uid;
    } catch {
      return `captcha-${guid()}`;
    }
  }

  /**
   * 从 fetcher payload 中解析 AJ-Captcha 响应（兼容 repCode 与 amis status 两种格式）。
   * @param payload env.fetcher 返回值
   * @returns {ok, data, msg}
   */
  parsePayload(payload: any): {ok: boolean; data: any; msg: string} {
    const json = payload?.data ?? {};
    const repData = json.repData ?? json.data ?? {};
    const repCode = json.repCode;
    const ok =
      repCode !== undefined
        ? String(repCode) === '0000'
        : json.status !== undefined
        ? json.status === 0
        : json.success === true;
    return {
      ok,
      data: repData || {},
      msg: json.repMsg || json.msg || payload?.msg || '请求失败'
    };
  }

  /**
   * 请求验证码图片（/captcha/get），失败时进入错误态。
   * @returns void
   */
  @autobind
  async loadCaptcha() {
    const {env, data, getApi, captchaType} = this.props;
    this.clearTimers();
    this.setState({loading: true, error: ''});
    try {
      // 直接把原始 api 配置交给 fetcher（其内部 buildApi 会合并第二参数的全部字段）；
      // 提前 buildApi 会把参数固化进 api.data，导致 fetcher 二次 build 时丢弃动态字段
      const payload = await env.fetcher(
        getApi || 'post:/captcha/get',
        createObject(data, {
          captchaType,
          clientUid: this.getClientUid(),
          ts: Date.now()
        })
      );
      const {ok, data: repData, msg} = this.parsePayload(payload);
      if (!ok || !repData?.originalImageBase64) {
        this.setState({
          loading: false,
          error: msg || '验证码获取失败，请稍后重试',
          status: 'ready'
        });
        return;
      }
      // curveSlider：解析曲线参数并预加载底图
      let curveParams: CurveParams | null = null;
      if (captchaType === 'curveSlider') {
        try {
          curveParams = JSON.parse(repData.jigsawImageBase64 || 'null');
        } catch {
          curveParams = null;
        }
        this.loadCurveBg(repData.originalImageBase64);
      }
      this.setState({loading: false, rep: repData, curveParams});
    } catch (e) {
      this.setState({loading: false, error: (e as Error)?.message || '请求异常'});
    }
  }

  /**
   * 预加载曲线底图（加载完成置 curveReady 触发重绘）。
   * @param base64 底图 PNG base64
   * @returns void
   */
  loadCurveBg(base64?: string) {
    if (!base64 || typeof Image === 'undefined') {
      return;
    }
    const img = new Image();
    img.onload = () => {
      this.bgImage = img;
      this.setState({curveReady: true});
    };
    img.src = `data:image/png;base64,${base64}`;
  }

  /**
   * 按当前滑块位移计算曲线活动控制点 x（310 基准，与官方一致）。
   * @returns 控制点 x
   */
  calcActiveCtrlX(): number {
    const p = this.state.curveParams;
    const bar = this.barRef.current;
    if (!p) {
      return 0;
    }
    const displayWidth = bar?.offsetWidth || this.props.width || CLICK_BASE_WIDTH;
    const scaled = (this.state.moveX * CLICK_BASE_WIDTH) / displayWidth;
    const maxSlide = Math.max(1, p.imgWidth - CURVE_BLOCK_WIDTH);
    const ratio = Math.min(1, Math.max(0, scaled / maxSlide));
    return Math.round(p.ctrlXMin + ratio * (p.ctrlXMax - p.ctrlXMin));
  }

  /**
   * 在 canvas 上绘制底图 + 活动曲线（curveSlider）。
   * 活动曲线颜色取当前主题 --primary，保证多主题下观感一致。
   * @returns void
   */
  @autobind
  drawCurve() {
    const canvas = this.canvasRef.current;
    const p = this.state.curveParams;
    if (!canvas || !p || !this.bgImage) {
      return;
    }
    canvas.width = p.imgWidth;
    canvas.height = p.imgHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, p.imgWidth, p.imgHeight);
    ctx.drawImage(this.bgImage, 0, 0, p.imgWidth, p.imgHeight);
    // 活动曲线（主题色半透明）
    const primary =
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() ||
      '#2468f2';
    const ctrlX = this.calcActiveCtrlX();
    ctx.beginPath();
    ctx.moveTo(p.startX, p.topY);
    ctx.quadraticCurveTo(ctrlX, p.bottomY, p.endX, p.topY);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = primary;
    ctx.globalAlpha = 0.75;
    ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = primary;
    [p.startX, p.endX].forEach(x => {
      ctx.beginPath();
      ctx.arc(x, p.topY, 5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  /**
   * 重置交互状态并重新拉取验证码（刷新按钮 / 验证失败自动调用）。
   * @returns void
   */
  @autobind
  refresh() {
    this.resetInteractiveState();
    this.loadCaptcha();
  }

  /**
   * 仅重置拖动/点选交互状态，不重新请求。
   * @returns void
   */
  resetInteractiveState() {
    this.clearTimers();
    this.setState({
      status: 'ready',
      moveX: 0,
      transition: true,
      points: [],
      tipText: '',
      tipStatus: '',
      curveReady: this.state.curveReady
    });
    this.timers.push(
      setTimeout(() => this.setState({transition: false}), 320)
    );
  }

  // ---------- 滑动（拼图 / 曲线共用滑轨） ----------

  /**
   * 滑块按下：记录拖动会话并绑定 document 事件（pointer + mouse 双绑定，防重复）。
   * @param e 指针/鼠标按下事件
   * @returns void
   */
  @autobind
  handleDragStart(e: React.PointerEvent | React.MouseEvent) {
    if (
      this.dragSession ||
      this.state.status === 'success' ||
      this.state.status === 'checking' ||
      this.props.disabled
    ) {
      return;
    }
    e.preventDefault();
    this.dragSession = {
      startClientX: e.clientX,
      startMoveX: this.state.moveX,
      startTime: Date.now()
    };
    document.addEventListener('pointermove', this.handleDragMove);
    document.addEventListener('pointerup', this.handleDragEnd);
    document.addEventListener('mousemove', this.handleDragMove);
    document.addEventListener('mouseup', this.handleDragEnd);
    this.setState({status: 'dragging', transition: false});
  }

  /**
   * 滑块拖动：按位移更新滑块位置，限制在滑轨内。
   * @param e document 指针/鼠标移动事件
   * @returns void
   */
  @autobind
  handleDragMove(e: PointerEvent | MouseEvent) {
    const session = this.dragSession;
    const bar = this.barRef.current;
    if (!session || !bar) {
      return;
    }
    const max = bar.offsetWidth - bar.offsetHeight; // 滑轨宽 - 滑块宽（正方形滑块）
    let moveX = session.startMoveX + (e.clientX - session.startClientX);
    moveX = Math.max(0, Math.min(max, moveX));
    this.setState({moveX});
  }

  /**
   * 滑块松开：按验证码类型换算坐标并提交校验。
   * - blockPuzzle：x = 位移px * 620 / 显示宽，y 恒为 5.0
   * - curveSlider：位移映射为曲线控制点 x，y 恒为 0
   * @returns void
   */
  @autobind
  handleDragEnd() {
    document.removeEventListener('pointermove', this.handleDragMove);
    document.removeEventListener('pointerup', this.handleDragEnd);
    document.removeEventListener('mousemove', this.handleDragMove);
    document.removeEventListener('mouseup', this.handleDragEnd);
    const session = this.dragSession;
    const bar = this.barRef.current;
    this.dragSession = null;
    if (!session || !bar) {
      return;
    }
    const elapsed = ((Date.now() - session.startTime) / 1000).toFixed(2);
    if (this.props.captchaType === 'curveSlider') {
      const ctrlX = this.calcActiveCtrlX();
      this.checkCaptcha({x: ctrlX, y: 0}, JSON.stringify({x: ctrlX, y: 0}), elapsed);
      return;
    }
    // 官方协议：x = 位移px * 620 / 显示宽，y 恒为 5.0
    const x = Math.round((this.state.moveX * PUZZLE_BASE_WIDTH) / bar.offsetWidth);
    this.checkCaptcha({x, y: 5}, JSON.stringify({x, y: 5.0}), elapsed);
  }

  /**
   * 解绑拖动事件（防止组件卸载后仍监听）。
   * @returns void
   */
  unbindDragEvents() {
    document.removeEventListener('pointermove', this.handleDragMove);
    document.removeEventListener('pointerup', this.handleDragEnd);
    document.removeEventListener('mousemove', this.handleDragMove);
    document.removeEventListener('mouseup', this.handleDragEnd);
  }

  // ---------- 点选文字 ----------

  /**
   * 点击验证码图片：记录坐标（310x155 基准），点满提示字数后提交校验。
   * @param e 图片点击事件
   * @returns void
   */
  @autobind
  handleImageClick(e: React.MouseEvent<HTMLImageElement>) {
    const {captchaType, disabled} = this.props;
    const {status, rep, points} = this.state;
    const need = rep.wordList?.length ?? 3;
    if (
      captchaType !== 'clickWord' ||
      disabled ||
      status === 'success' ||
      status === 'checking' ||
      points.length >= need
    ) {
      return;
    }
    const img = e.currentTarget;
    // 官方协议：x 按 310 基准、y 按 155 基准换算
    const x = Math.round((e.nativeEvent.offsetX * CLICK_BASE_WIDTH) / img.offsetWidth);
    const y = Math.round((e.nativeEvent.offsetY * CLICK_BASE_HEIGHT) / img.offsetHeight);
    const next = [
      ...points,
      {x, y, rawX: e.nativeEvent.offsetX, rawY: e.nativeEvent.offsetY}
    ];
    this.setState({points: next});
    if (next.length === need) {
      const pointList = next.map(p => ({x: p.x, y: p.y}));
      this.checkCaptcha(pointList, JSON.stringify(pointList));
    }
  }

  // ---------- 校验 ----------

  /**
   * 提交行为校验（/captcha/check），成功后产出 captchaVerification 并写入表单值。
   *
   * @param point 提交用的坐标（对象或数组）
   * @param pointJsonStr 坐标的 JSON 字符串（参与凭证拼接的原文）
   * @param elapsed 拖动耗时（秒，展示用）
   * @returns void
   */
  @autobind
  async checkCaptcha(point: any, pointJsonStr: string, elapsed?: string) {
    const {env, data, checkApi, captchaType, dispatchEvent, onChange} = this.props;
    const {rep} = this.state;
    if (!rep.token) {
      return;
    }
    this.setState({status: 'checking'});
    const pointJson = rep.secretKey
      ? captchaAesEncrypt(pointJsonStr, rep.secretKey)
      : pointJsonStr;
    let payload: any;
    try {
      payload = await env.fetcher(
        checkApi || 'post:/captcha/check',
        createObject(data, {
          captchaType,
          pointJson,
          token: rep.token,
          clientUid: this.getClientUid(),
          ts: Date.now()
        })
      );
    } catch (e) {
      this.fail((e as Error)?.message || '请求异常', elapsed);
      return;
    }
    const {ok, msg} = this.parsePayload(payload);
    if (!ok) {
      this.fail(msg, elapsed);
      return;
    }
    // 二次校验凭证：AES(token + '---' + pointJson 原文)
    const captchaVerification = rep.secretKey
      ? captchaAesEncrypt(`${rep.token}---${pointJsonStr}`, rep.secretKey)
      : `${rep.token}---${pointJsonStr}`;
    const rendererEvent = await dispatchEvent(
      'change',
      resolveEventData(this.props, {value: captchaVerification})
    );
    if (!rendererEvent?.prevented) {
      onChange?.(captchaVerification);
    }
    await dispatchEvent(
      'success',
      resolveEventData(this.props, {
        value: captchaVerification,
        captchaVerification,
        token: rep.token,
        captchaType,
        points: point
      })
    );
    this.setState({
      status: 'success',
      tipStatus: 'success',
      tipText: elapsed ? `${elapsed}s 验证成功` : '验证成功'
    });
    if (this.props.displayMode === 'popup') {
      // 弹窗模式：只关弹窗不重置成功态（按钮保持"验证通过"，腾讯验证码同款反馈），
      // 用户再次点击按钮时才重新出一局
      this.timers.push(
        setTimeout(() => {
          this.setState({open: false});
        }, 1000)
      );
    }
  }

  /**
   * 校验失败处理：提示后自动刷新重试。
   * @param msg 失败提示
   * @param elapsed 耗时（秒）
   * @returns void
   */
  @autobind
  async fail(msg: string, elapsed?: string) {
    const {dispatchEvent} = this.props;
    this.setState({
      status: 'fail',
      tipStatus: 'fail',
      tipText: msg || '验证失败，请重试'
    });
    await dispatchEvent('fail', resolveEventData(this.props, {msg}));
    this.timers.push(setTimeout(() => this.refresh(), 1000));
  }

  /**
   * 响应组件动作：
   * - open：打开弹出验证（popup 形态；已验证状态下会先清值并重新出一局）
   * - refresh 刷新验证码 / clear 清空值 / reset 恢复初始值
   * @param action 动作对象
   * @param data 数据域
   * @param throwErrors 是否抛错（未使用，保持签名）
   * @returns void
   */
  doAction(action: ActionObject, data: object, throwErrors: boolean) {
    const {onChange, resetValue, formStore, store, name, displayMode} = this.props;
    const actionType = action?.actionType as string;
    if (actionType === 'open') {
      // 外部组件（如"发送短信"按钮）通过组件动作唤起验证
      if (displayMode === 'popup') {
        this.openPopup();
      }
    } else if (actionType === 'refresh') {
      this.refresh();
    } else if (actionType === 'clear') {
      onChange?.('');
      this.refresh();
    } else if (actionType === 'reset') {
      const pristine =
        // @ts-ignore 兼容 v1 写法，与 Radios 保持一致
        (formStore?.pristine ?? store?.pristine)?.[name!] ?? resetValue;
      onChange?.(pristine ?? '');
      this.refresh();
    }
  }

  // ---------- 渲染 ----------

  /**
   * 渲染验证码面板（图片/画布区 + 滑轨/提示条）。
   * @returns JSX
   */
  renderPanel() {
    const {classnames: cx, captchaType, width, disabled, displayMode} = this.props;
    const {loading, error, rep, status, moveX, transition, points, tipText, tipStatus} =
      this.state;
    const displayWidth = width || 310;
    // H5 自适应：宽度按配置、上限撑满容器，高度用 aspect-ratio 跟随缩放
    // （坐标换算按实际 offsetWidth 动态计算，任意显示宽度下都正确）
    const boxStyle: React.CSSProperties = {
      width: displayWidth,
      maxWidth: '100%',
      aspectRatio: '2 / 1'
    };

    // 点选提示条（仅嵌入模式、未成功时）：弹出模式的指引在弹窗标题上；
    // 成功提示由图片区中央结果层承载（对齐腾讯），不再重复
    const tipbar =
      captchaType === 'clickWord' &&
      displayMode !== 'popup' &&
      status !== 'success' ? (
        <div className={cx('CaptchaControl-tipbar', `is--${tipStatus}`)}>
          请依次点击
          <span className={cx('CaptchaControl-tipbarWords')}>
            【{(rep.wordList || []).join(' ')}】
          </span>
        </div>
      ) : null;

    return (
      <div className={cx('CaptchaControl', {'is--disabled': disabled})}>
        {tipbar}
        <div className={cx('CaptchaControl-imgBox')} style={boxStyle}>
          <Spinner show={loading} size="sm" className={cx('CaptchaControl-spinner')} />
          {error ? (
            <div className={cx('CaptchaControl-error')}>
              <Icon icon="warning" className="icon" />
              <span>{error}</span>
              <a className={cx('CaptchaControl-errorRetry')} onClick={this.refresh}>
                重试
              </a>
            </div>
          ) : captchaType === 'curveSlider' ? (
            <canvas
              className={cx('CaptchaControl-canvas')}
              ref={this.canvasRef}
              style={boxStyle}
            />
          ) : (
            <>
              <img
                className={cx('CaptchaControl-img', {
                  'is--clickable': captchaType === 'clickWord'
                })}
                src={`data:image/png;base64,${rep.originalImageBase64}`}
                onClick={this.handleImageClick}
                draggable={false}
              />
              {captchaType === 'blockPuzzle' && rep.jigsawImageBase64 ? (
                <div
                  className={cx('CaptchaControl-piece')}
                  // 拼图条宽度按基准比例取百分比，随容器缩放保持对齐
                  style={{
                    width: `${(PUZZLE_STRIP_BASE_WIDTH / PUZZLE_BASE_WIDTH) * 100}%`,
                    height: '100%',
                    left: moveX
                  }}
                >
                  <img
                    src={`data:image/png;base64,${rep.jigsawImageBase64}`}
                    draggable={false}
                  />
                </div>
              ) : null}
            </>
          )}
          {captchaType !== 'curveSlider' &&
            points.map((p, index) => (
              <span
                key={index}
                className={cx('CaptchaControl-marker')}
                style={{left: p.rawX, top: p.rawY}}
              >
                {index + 1}
              </span>
            ))}
          {/* 结果遮罩（对齐腾讯）：成功=白蒙层+绿色大对勾+文案；失败=浅粉蒙层 */}
          {status === 'success' ? (
            <div className={cx('CaptchaControl-resultOverlay', 'is--success')}>
              <CheckIcon className={cx('CaptchaControl-resultIcon')} />
              <span className={cx('CaptchaControl-resultText')}>验证成功！</span>
            </div>
          ) : null}
          {status === 'fail' ? (
            <div className={cx('CaptchaControl-resultOverlay', 'is--fail')} />
          ) : null}
          {/* 失败提示条：浮层贴图片底部（不占布局空间，对齐腾讯） */}
          {status === 'fail' && tipText ? (
            <div className={cx('CaptchaControl-errorbar')}>{tipText}</div>
          ) : null}
        </div>

        {captchaType !== 'clickWord' && (
          <div className={cx('CaptchaControl-slider', `is--${status}`)} ref={this.barRef}>
            <div
              className={cx('CaptchaControl-sliderTrail')}
              style={{width: moveX, transition: transition ? 'width .3s' : undefined}}
            />
            <div
              className={cx('CaptchaControl-sliderHandle')}
              onPointerDown={this.handleDragStart}
              onMouseDown={this.handleDragStart}
              style={{left: moveX, transition: transition ? 'left .3s' : undefined}}
            >
              <Icon
                icon={
                  status === 'success'
                    ? 'check'
                    : status === 'fail'
                    ? 'close'
                    : 'right-double-arrow'
                }
                className="icon"
              />
            </div>
            {/* 弹出形态的操作指引在弹窗标题上，滑轨不再内嵌文字（对齐腾讯样式） */}
            {displayMode === 'popup' ? null : (
              <span className={cx('CaptchaControl-sliderText')}>
                {status === 'success'
                  ? '验证成功'
                  : status === 'fail'
                  ? tipText || '验证失败，请重试'
                  : status === 'checking'
                  ? '校验中...'
                  : captchaType === 'curveSlider'
                  ? '拖动滑块使曲线重合'
                  : '拖动滑块完成验证'}
              </span>
            )}
          </div>
        )}

        {/* 底部状态栏：品牌说明 + 刷新入口（对齐腾讯底部栏布局） */}
        <div className={cx('CaptchaControl-footer')}>
          <span className={cx('CaptchaControl-footerText')}>安全验证</span>
          <a
            className={cx('CaptchaControl-footerRefresh')}
            title="刷新验证"
            onClick={this.refresh}
          >
            <RefreshCwIcon className={cx('CaptchaControl-footerRefreshIcon')} />
          </a>
        </div>
      </div>
    );
  }

  render() {
    const {
      classnames: cx,
      className,
      displayMode,
      actionText,
      disabled,
      hideTrigger,
      captchaType
    } = this.props;
    const {open, status, rep} = this.state;
    const verified = status === 'success';

    if (displayMode === 'popup') {
      // 腾讯验证码风格：标题即动态操作指引（如"拖动下方滑块完成拼图"），
      // 滑轨不再内嵌提示文字；成功后显示绿色过渡屏，1s 自动关闭
      const title =
        captchaType === 'clickWord'
          ? `请依次点击：${(rep.wordList || []).join(' ')}`
          : captchaType === 'curveSlider'
          ? '拖动滑块使曲线重合'
          : '拖动下方滑块完成拼图';
      return (
        <div className={cx('CaptchaControlWrap', className)}>
          {hideTrigger ? null : (
            <Button
              level={verified ? 'success' : 'default'}
              className={cx('CaptchaControl-trigger')}
              disabled={disabled}
              onClick={this.openPopup}
            >
              {verified ? (
                <>
                  <Icon icon="check" className={cx('CaptchaControl-triggerIcon')} />
                  验证通过
                </>
              ) : (
                <>
                  <ShieldCheckIcon className={cx('CaptchaControl-triggerIcon')} />
                  {actionText}
                </>
              )}
            </Button>
          )}
          {open ? (
            <div className={cx('CaptchaControl-mask')}>
              <div className={cx('CaptchaControl-pop')}>
                <div className={cx('CaptchaControl-popHeader')}>
                  <span className={cx('CaptchaControl-popTitle')}>{title}</span>
                  <a
                    className={cx('CaptchaControl-popClose')}
                    onClick={() => this.setState({open: false})}
                  >
                    <Icon icon="close" className="icon" />
                  </a>
                </div>
                <div className={cx('CaptchaControl-popBody')}>
                  {this.renderPanel()}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      );
    }

    return this.renderPanel();
  }

  /**
   * 弹出模式：打开弹窗并按需首次加载验证码。
   * 已验证状态下再次点击 = 重新验证：清空旧凭证并刷新一局。
   * @returns void
   */
  @autobind
  async openPopup() {
    const {dispatchEvent, onChange} = this.props;
    if (this.state.status === 'success') {
      // 旧凭证作废：走 change 事件范式清值后重新出题
      const rendererEvent = await dispatchEvent(
        'change',
        resolveEventData(this.props, {value: ''})
      );
      if (!rendererEvent?.prevented) {
        onChange?.('');
      }
      this.refresh();
    } else if (!this.state.rep.token && !this.state.loading) {
      this.loadCaptcha();
    }
    this.setState({open: true});
  }
}

@FormItem({
  type: 'captcha',
  sizeMutable: false
})
export class CaptchaRenderer extends CaptchaControl {}
