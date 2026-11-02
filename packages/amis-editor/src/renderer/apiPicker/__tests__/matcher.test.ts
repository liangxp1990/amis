// packages/amis-editor/src/renderer/apiPicker/__tests__/matcher.test.ts
import {fuzzyMatchApi} from '../matcher';
import type {ApiItem} from '../types';

const items: ApiItem[] = [
  {name: '获取用户列表', method: 'get', path: '/api/user/list'},
  {name: '创建用户', method: 'post', path: '/api/user/create'},
  {name: '订单详情', method: 'get', path: '/api/order/detail'}
];

describe('apiPicker: fuzzyMatchApi', () => {
  it('按名称或路径忽略大小写匹配', () => {
    expect(fuzzyMatchApi(items, 'USER')).toHaveLength(2); // 名称含"用户"不含 USER；路径含 user
    expect(fuzzyMatchApi(items, '用户')).toHaveLength(2);
    expect(fuzzyMatchApi(items, '/api/order')).toEqual([items[2]]);
  });

  it('前缀命中排在包含命中之前', () => {
    const list: ApiItem[] = [
      {name: '订单详情', method: 'get', path: '/b'},     // 名称前缀命中
      {name: 'x', method: 'get', path: '/订单/c'},       // 路径包含命中
      {name: '详情-订单', method: 'get', path: '/a'}     // 名称包含命中
    ];
    expect(fuzzyMatchApi(list, '订单')).toEqual([list[0], list[1], list[2]]);
    // '/订单' 仅命中路径前缀（注意 path 以 / 开头，'订单' 打头不会前缀命中）
    expect(fuzzyMatchApi(list, '/订单')).toEqual([list[1]]);
  });

  it('空关键词返回全部；无匹配返回空数组', () => {
    expect(fuzzyMatchApi(items, '')).toEqual(items);
    expect(fuzzyMatchApi(items, '  ')).toEqual(items);
    expect(fuzzyMatchApi(items, '不存在')).toEqual([]);
  });
});
