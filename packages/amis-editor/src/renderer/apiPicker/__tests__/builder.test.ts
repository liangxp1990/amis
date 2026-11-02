// packages/amis-editor/src/renderer/apiPicker/__tests__/builder.test.ts
import {buildApiFromItem, joinUrl} from '../builder';
import type {ApiItem} from '../types';

describe('apiPicker: joinUrl 前缀拼接', () => {
  it('常规拼接', () => {
    expect(joinUrl('/api', '/user/list')).toBe('/api/user/list');
  });

  it('去重中间斜杠（springdoc servers url 常以 / 结尾）', () => {
    expect(joinUrl('/api/', '/user/list')).toBe('/api/user/list');
    expect(joinUrl('http://host/api//', '//user')).toBe('http://host/api/user');
  });

  it('前缀为空返回原 path', () => {
    expect(joinUrl('', '/user')).toBe('/user');
    expect(joinUrl(undefined as any, '/user')).toBe('/user');
  });
});

describe('apiPicker: buildApiFromItem 入参自动化', () => {
  it('path 参数替换为 ${name} 占位，前缀拼接', () => {
    const item: ApiItem = {
      name: '用户详情',
      method: 'get',
      path: '/user/{id}',
      prefix: '/api',
      pathParams: [{name: 'id', path: 'id', type: 'string', required: true}]
    };
    expect(buildApiFromItem(item)).toEqual({
      method: 'get',
      url: '/api/user/${id}'
    });
  });

  it('query 参数生成 data 映射（GET 时 amis 自动序列化为 query）', () => {
    const item: ApiItem = {
      name: '列表',
      method: 'get',
      path: '/user/list',
      queryParams: [
        {name: 'pageNum', path: 'pageNum', required: true},
        {name: 'keyword', path: 'keyword'}
      ]
    };
    expect(buildApiFromItem(item)).toEqual({
      method: 'get',
      url: '/user/list',
      data: {pageNum: '${pageNum}', keyword: '${keyword}'}
    });
  });

  it('body 参数生成嵌套 data 映射，占位用完整路径', () => {
    const item: ApiItem = {
      name: '创建',
      method: 'post',
      path: '/user/create',
      bodyParams: [
        {name: 'name', path: 'name', type: 'string', required: true},
        {
          name: 'profile',
          path: 'profile',
          type: 'object',
          children: [
            {name: 'city', path: 'profile.city', type: 'string'}
          ]
        }
      ]
    };
    expect(buildApiFromItem(item)).toEqual({
      method: 'post',
      url: '/user/create',
      data: {name: '${name}', profile: {city: '${profile.city}'}}
    });
  });

  it('简单列表 extra 透传且不污染缓存中的原对象', () => {
    const extra = {data: {a: 1}, headers: {'X-Token': 't'}};
    const item: ApiItem = {
      name: 'x',
      method: 'post',
      path: '/x',
      extra
    };
    const api: any = buildApiFromItem(item);
    expect(api.headers).toEqual({'X-Token': 't'});
    api.headers['X-Token'] = 'changed';
    expect(extra.headers['X-Token']).toBe('t');
  });

  it('extra 含 data 键时整体覆盖生成的参数映射（宿主自定义优先）', () => {
    const item: ApiItem = {
      name: 'x',
      method: 'post',
      path: '/x',
      queryParams: [{name: 'a', path: 'a'}],
      extra: {data: {custom: 1}}
    };
    expect(buildApiFromItem(item)).toEqual({
      method: 'post',
      url: '/x',
      data: {custom: 1}
    });
  });

  it('无参数时只含 method/url', () => {
    expect(
      buildApiFromItem({name: 'x', method: 'get', path: '/x'})
    ).toEqual({method: 'get', url: '/x'});
  });
});
