// packages/amis-editor/src/renderer/apiPicker/loader.ts
import {detectApiSource} from './detect';
import {parseOpenApi3, parseSwagger2} from './openapi';
import {parseSimpleList} from './simple-list';
import type {ApiItem} from './types';

/**
 * env.fetcher 的最小签名（由 APIControl 注入，保持模块纯净可测）。
 */
export type ApiFetcher = (api: any, ctx?: any) => Promise<any>;

/** 失败提示原始文案（UI 层用 __() 翻译后 toast；文案由 npm run i18n:update 自动提取进 locale 哈希表） */
export const API_LOAD_FAILED_MSG = '接口列表获取失败';

/**
 * 模块级缓存：存 Promise 而非结果——既缓存成功/失败（负缓存），
 * 也天然去重并发 in-flight 请求（编辑器内多实例同时首次加载只发一次）。
 * key 为 getApi 定义序列化。
 */
const cache = new Map<string, Promise<ApiItem[] | null>>();

/** 失败 toast 全局去重：编辑器会话内只提示一次 */
let failureNotified = false;

/** 缓存 key：字符串原样，对象 JSON 序列化 */
function cacheKey(getApi: any): string {
  if (typeof getApi === 'string') {
    return getApi;
  }
  try {
    return JSON.stringify(getApi);
  } catch (e) {
    return String(getApi);
  }
}

/** 清空模块级缓存与去重标记（测试用） */
export function resetApiCache(): void {
  cache.clear();
  failureNotified = false;
}

/**
 * 拉取并解析接口列表（模块级缓存共享：编辑器内多实例只请求一次）。
 * What: 命中缓存直接返回缓存 Promise；未命中发起加载并立即写入缓存
 *   （并发调用共享同一次请求）；失败结果 resolve 为 null 且同样缓存
 *   （负缓存，编辑器会话内不再重试）。
 * Args: getApi - 全局配置（SchemaApi）; fetcher - env.fetcher;
 *   notify - 失败提示回调（入参为原始中文文案，UI 层翻译后 toast，全局去重一次）
 * Returns: 接口列表；失败/非法响应返回 null（调用方降级为普通手输）
 */
export function loadApiItems(
  getApi: any,
  fetcher: ApiFetcher,
  notify?: (msg: string) => void
): Promise<ApiItem[] | null> {
  const key = cacheKey(getApi);
  let cached = cache.get(key);
  if (!cached) {
    cached = doLoad(getApi, fetcher, notify);
    cache.set(key, cached);
  }
  return cached;
}

/** 实际加载：fetcher 拉取 → detect 探测 → 分发解析；失败通知（全局去重） */
async function doLoad(
  getApi: any,
  fetcher: ApiFetcher,
  notify?: (msg: string) => void
): Promise<ApiItem[] | null> {
  let result: ApiItem[] | null = null;
  try {
    const res = await fetcher(getApi);
    result = parseResponse(res);
  } catch (e) {
    result = null;
  }

  if (!result && !failureNotified) {
    failureNotified = true;
    notify?.(API_LOAD_FAILED_MSG);
  }
  return result;
}

/** 按探测格式分发解析；未知结构返回 null */
function parseResponse(res: any): ApiItem[] | null {
  const detected = detectApiSource(res);
  if (!detected) {
    return null;
  }
  switch (detected.kind) {
    case 'openapi3':
      return parseOpenApi3(detected.body);
    case 'swagger2':
      return parseSwagger2(detected.body);
    case 'simple':
      return parseSimpleList(detected.body);
  }
}
