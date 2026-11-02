// packages/amis-editor/src/renderer/apiPicker/__tests__/detect.test.ts
import {detectApiSource} from '../detect';

describe('apiPicker: detectApiSource', () => {
  // 裸文档在 res.data（仓库默认 fetcher：直接返回 axios response）
  it('探测 res.data 层的 OpenAPI 3.0', () => {
    const res = {data: {openapi: '3.0.1', paths: {}}};
    expect(detectApiSource(res)).toEqual({kind: 'openapi3', body: res.data});
  });

  it('探测 res.data 层的 Swagger 2.0', () => {
    const res = {data: {swagger: '2.0', paths: {}}};
    expect(detectApiSource(res)).toEqual({kind: 'swagger2', body: res.data});
  });

  // 按 amis 协议解包的宿主 fetcher：文档在 res.data.data
  it('探测 res.data.data 层的 OpenAPI（宿主 fetcher 已解包）', () => {
    const res = {data: {status: 0, data: {openapi: '3.0.1', paths: {}}}};
    expect(detectApiSource(res)).toEqual({
      kind: 'openapi3',
      body: res.data.data
    });
  });

  it('探测 res.data.data 层的简单列表（已解包）', () => {
    const res = {
      data: {status: 0, data: {items: [{name: 'a', method: 'get', url: '/a'}]}}
    };
    expect(detectApiSource(res)).toEqual({kind: 'simple', body: res.data.data});
  });

  // res.data 是标准 amis 响应但内层无已知结构 → 视为文档在 data.data 层探测失败
  it('res.data 优先：两层都像已知结构时取先命中的外层', () => {
    const res = {data: {swagger: '2.0', paths: {}, data: {items: []}}};
    expect(detectApiSource(res)?.kind).toBe('swagger2');
  });

  it('两层均未命中返回 null', () => {
    expect(detectApiSource({data: {status: 0, data: {foo: 1}}})).toBeNull();
    expect(detectApiSource({data: null})).toBeNull();
    expect(detectApiSource(undefined)).toBeNull();
  });
});
