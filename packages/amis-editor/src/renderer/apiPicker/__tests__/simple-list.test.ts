// packages/amis-editor/src/renderer/apiPicker/__tests__/simple-list.test.ts
import {parseSimpleList} from '../simple-list';

describe('apiPicker: parseSimpleList', () => {
  it('url 归一映射到 path，多余字段进 extra，name 缺省用 url', () => {
    const items = parseSimpleList({
      items: [
        {name: '用户列表', method: 'GET', url: '/api/user', data: {a: '${a}'}},
        {url: '/api/orphan'}
      ]
    });
    expect(items).toEqual([
      {
        name: '用户列表',
        method: 'get',
        path: '/api/user',
        extra: {data: {a: '${a}'}}
      },
      {name: '/api/orphan', method: 'get', path: '/api/orphan'}
    ]);
  });

  it('缺少 url 的项被过滤；items 非法返回空数组', () => {
    expect(parseSimpleList({items: [{name: 'x'}]})).toEqual([]);
    expect(parseSimpleList({})).toEqual([]);
    expect(parseSimpleList(null)).toEqual([]);
  });
});
