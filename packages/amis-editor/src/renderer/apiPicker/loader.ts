// packages/amis-editor/src/renderer/apiPicker/loader.ts
import {detectApiSource} from './detect';
import {parseOpenApi3, parseSwagger2} from './openapi';
import {parseSimpleList} from './simple-list';
import type {ApiItem} from './types';

/**
 * env.fetcher 的最小签名（由 APIControl 注入，保持模块纯净可测）。
 */
export type ApiFetcher = (api: any, ctx?: any) => Promise<any>;

/**
 * 模块级缓存：存 Promise 而非结果——既缓存成功/失败（负缓存），
 * 也天然去重并发 in-flight 请求（编辑器内多实例同时首次加载只发一次）。
 * key 为 getApi 定义序列化。
 */
const cache = new Map<string, Promise<ApiItem[] | null>>();

/** 失败 toast 全局去重：编辑器会话内只提示一次 */
let failureNotified = false;

/** 缓存 key：字符串原样，对象稳定序列化（递归按 key 排序，键序无关） */
function cacheKey(getApi: any): string {
  if (typeof getApi === 'string') {
    return getApi;
  }
  try {
    return stableStringify(getApi);
  } catch (e) {
    return String(getApi);
  }
}

/**
 * 稳定序列化：对象按 key 排序后再序列化。
 * What: 使内容相同但键序不同的对象产出同一字符串（共享缓存 key），
 *   如 {url,method} 与 {method,url}；数组保持元素顺序。
 * Args: value - 待序列化的值
 * Returns: 序列化字符串
 * Raises: 循环引用等导致的递归异常由调用方 cacheKey 捕获后降级为 String(getApi)
 */
function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => stableStringify(item)).join(',')}]`;
  }
  const keys = Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${keys.join(',')}}`;
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
 *   notify - 失败提示回调（无参，文案由 UI 层自带并翻译，全局去重一次）
 * Returns: 接口列表；失败/非法响应返回 null（调用方降级为普通手输）
 */
export function loadApiItems(
  getApi: any,
  fetcher: ApiFetcher,
  notify?: () => void
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
  notify?: () => void
): Promise<ApiItem[] | null> {
  let result: ApiItem[] | null = null;
  try {
    const res = await fetcher(getApi);
    result = parseResponse(res);
  } catch (e) {
    result = null;
  }

  // 仅在有 notify 回调时占用全局去重标记，避免无回调的失败吞掉后续实例的 toast；
  // 失败结果仍照常缓存（负缓存语义不变）
  if (!result && notify && !failureNotified) {
    failureNotified = true;
    notify();
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
