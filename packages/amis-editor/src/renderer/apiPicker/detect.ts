// packages/amis-editor/src/renderer/apiPicker/detect.ts
import type {ApiSourceKind} from './types';

/** 探测结果：格式 + 命中层的 body 引用（供解析器直接使用） */
export interface DetectedSource {
  kind: ApiSourceKind;
  body: any;
}

/**
 * 探测 fetcher 响应中的接口定义格式。
 * What: 兼容两类宿主 fetcher——仓库默认 fetcher 直接返回 axios response（裸文档在
 *   res.data），按 amis 协议解包的 fetcher（裸文档在 res.data.data），两层依次检查。
 * Args: response - env.fetcher 的返回值
 * Returns: {kind, body}；两层均未命中已知结构返回 null（视为非法响应，走降级）
 */
export function detectApiSource(response: any): DetectedSource | null {
  const layers = [response?.data, response?.data?.data];

  for (const body of layers) {
    if (!body || typeof body !== 'object') {
      continue;
    }
    if (typeof body.openapi === 'string') {
      return {kind: 'openapi3', body};
    }
    if (typeof body.swagger === 'string') {
      return {kind: 'swagger2', body};
    }
    if (Array.isArray(body.items)) {
      return {kind: 'simple', body};
    }
  }
  return null;
}
