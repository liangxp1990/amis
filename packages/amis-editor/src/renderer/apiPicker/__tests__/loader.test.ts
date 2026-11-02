// packages/amis-editor/src/renderer/apiPicker/__tests__/loader.test.ts
import {loadApiItems, resetApiCache} from '../loader';
import type {ApiFetcher} from '../loader';

const openapiRes = {
  data: {openapi: '3.0.1', paths: {'/a': {get: {summary: 'A'}}}}
};

function makeFetcher(res: any, impl?: (api: any) => Promise<any>): ApiFetcher {
  return impl ? (impl as ApiFetcher) : async () => res;
}

beforeEach(() => {
  resetApiCache();
});

describe('apiPicker: loadApiItems', () => {
  it('拉取并按探测格式解析为接口列表', async () => {
    const items = await loadApiItems('/v3/api-docs', makeFetcher(openapiRes));
    expect(items).toEqual([{name: 'A', method: 'get', path: '/a'}]);
  });

  it('同 getApi 配置多实例只请求一次（模块级缓存）', async () => {
    let calls = 0;
    const fetcher = makeFetcher(openapiRes, async () => {
      calls++;
      return openapiRes;
    });
    await loadApiItems('/v3/api-docs', fetcher);
    await loadApiItems('/v3/api-docs', fetcher);
    expect(calls).toBe(1);
  });

  it('不同 getApi 配置独立缓存', async () => {
    let calls = 0;
    const fetcher = makeFetcher(openapiRes, async () => {
      calls++;
      return openapiRes;
    });
    await loadApiItems('/a', fetcher);
    await loadApiItems('/b', fetcher);
    expect(calls).toBe(2);
  });

  it('请求失败：返回 null、负缓存（会话内不重试）、notify 触发一次', async () => {
    let calls = 0;
    const notify = jest.fn();
    const fetcher = makeFetcher(null, async () => {
      calls++;
      throw new Error('network');
    });
    expect(await loadApiItems('/bad', fetcher, notify)).toBeNull();
    expect(await loadApiItems('/bad', fetcher, notify)).toBeNull();
    expect(calls).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('响应非法（未知结构）：返回 null 且计入负缓存', async () => {
    const notify = jest.fn();
    const fetcher = makeFetcher({data: {status: 0, data: {foo: 1}}});
    expect(await loadApiItems('/x', fetcher, notify)).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('失败 toast 全局去重：不同 getApi 的第二次失败不再 notify', async () => {
    const notify = jest.fn();
    await loadApiItems(
      '/bad1',
      makeFetcher(null, async () => {
        throw 0;
      }),
      notify
    );
    await loadApiItems(
      '/bad2',
      makeFetcher(null, async () => {
        throw 0;
      }),
      notify
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('简单列表（已解包层）解析', async () => {
    const res = {data: {status: 0, data: {items: [{name: 'n', url: '/n'}]}}};
    const items = await loadApiItems('/list', makeFetcher(res));
    expect(items).toEqual([{name: 'n', method: 'get', path: '/n'}]);
  });

  it('对象型 getApi：键序不同内容相同共享缓存，只请求一次（稳定序列化）', async () => {
    let calls = 0;
    const fetcher = makeFetcher(openapiRes, async () => {
      calls++;
      return openapiRes;
    });
    await loadApiItems({method: 'get', url: '/v3/api-docs'}, fetcher);
    await loadApiItems({url: '/v3/api-docs', method: 'get'}, fetcher);
    await loadApiItems({method: 'get', url: '/v3/api-docs'}, fetcher);
    expect(calls).toBe(1);
  });

  it('无 notify 的失败不占用全局去重标记，后续实例仍能收到 toast', async () => {
    const notify = jest.fn();
    const failer = makeFetcher(null, async () => {
      throw new Error('x');
    });
    expect(await loadApiItems('/silent', failer)).toBeNull();
    expect(await loadApiItems('/loud', failer, notify)).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('并发首次加载共享同一次请求（in-flight 去重）', async () => {
    let calls = 0;
    const fetcher: ApiFetcher = async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return openapiRes;
    };
    const [a, b] = await Promise.all([
      loadApiItems('/concurrent', fetcher),
      loadApiItems('/concurrent', fetcher)
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });
});
