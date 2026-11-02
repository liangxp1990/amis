// packages/amis-editor/src/renderer/apiPicker/__tests__/openapi.test.ts
import {parseOpenApi3, parseSwagger2} from '../openapi';

/** 最小可用的 OpenAPI 3.0 文档 */
function openApi3Doc(): any {
  return {
    openapi: '3.0.1',
    servers: [{url: '/api'}],
    paths: {
      '/user/list': {
        get: {
          summary: '获取用户列表',
          tags: ['用户管理'],
          parameters: [
            {
              name: 'pageNum',
              in: 'query',
              required: true,
              schema: {type: 'integer'}
            },
            {
              name: 'keyword',
              in: 'query',
              schema: {type: 'string'},
              description: '搜索词'
            }
          ]
        }
      },
      '/user/{id}': {
        parameters: [
          {name: 'id', in: 'path', required: true, schema: {type: 'string'}}
        ],
        get: {
          operationId: 'getUserDetail',
          parameters: [
            {name: 'verbose', in: 'query', schema: {type: 'boolean'}}
          ]
        }
      },
      '/user/create': {
        post: {
          summary: '创建用户',
          requestBody: {
            content: {
              'application/json': {
                schema: {$ref: '#/components/schemas/UserCreateReq'}
              }
            }
          }
        }
      },
      '/user/import': {
        post: {
          summary: '导入用户',
          requestBody: {
            content: {
              'application/json': {
                schema: {$ref: '#/components/schemas/DeepReq'}
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        UserCreateReq: {
          type: 'object',
          required: ['name'],
          properties: {
            name: {type: 'string', description: '用户名'},
            role: {type: 'string', enum: ['admin', 'user']},
            profile: {
              type: 'object',
              properties: {address: {type: 'string'}, city: {type: 'string'}}
            }
          }
        },
        // 组合环：A.b → B，B.a → A
        DeepReq: {
          type: 'object',
          properties: {
            b: {$ref: '#/components/schemas/LoopB'},
            plain: {type: 'string'}
          }
        },
        LoopB: {
          type: 'object',
          properties: {a: {$ref: '#/components/schemas/DeepReq'}}
        }
      }
    }
  };
}

describe('apiPicker: parseOpenApi3', () => {
  it('遍历 paths，每个 path × method 一项，取 servers[0].url 为前缀', () => {
    const items = parseOpenApi3(openApi3Doc());
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      name: '获取用户列表',
      method: 'get',
      path: '/user/list',
      prefix: '/api',
      tags: ['用户管理'],
      queryParams: [
        {name: 'pageNum', type: 'integer', required: true},
        {name: 'keyword', type: 'string', description: '搜索词'}
      ]
    });
  });

  it('无 summary 时依次回退 operationId / path', () => {
    const items = parseOpenApi3(openApi3Doc());
    const detail = items.find(i => i.path === '/user/{id}')!;
    expect(detail.name).toBe('getUserDetail');
    expect(detail.pathParams).toEqual([
      {name: 'id', type: 'string', required: true, path: 'id'}
    ]);
  });

  it('pathItem 级与 operation 级 parameters 合并', () => {
    const detail = parseOpenApi3(openApi3Doc()).find(
      i => i.path === '/user/{id}'
    )!;
    expect(detail.queryParams).toEqual([
      {name: 'verbose', type: 'boolean', path: 'verbose'}
    ]);
  });

  it('$ref 递归解析 requestBody：required/enum/description/嵌套对象下钻', () => {
    const create = parseOpenApi3(openApi3Doc()).find(
      i => i.path === '/user/create'
    )!;
    expect(create.bodyParams).toEqual([
      {
        name: 'name',
        path: 'name',
        type: 'string',
        required: true,
        description: '用户名'
      },
      {name: 'role', path: 'role', type: 'string', enum: ['admin', 'user']},
      {
        name: 'profile',
        path: 'profile',
        type: 'object',
        children: [
          {name: 'address', path: 'profile.address', type: 'string'},
          {name: 'city', path: 'profile.city', type: 'string'}
        ]
      }
    ]);
  });

  it('RFC 6901：$ref 段 ~1/~0 反转义到含 / 或 ~ 的 schema 名', () => {
    const doc: any = {
      openapi: '3.0.1',
      paths: {
        '/x': {
          post: {
            summary: 'X',
            requestBody: {
              content: {
                'application/json': {
                  schema: {$ref: '#/components/schemas/Foo~1Bar'}
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          'Foo/Bar': {
            type: 'object',
            required: ['id'],
            properties: {id: {type: 'string'}}
          }
        }
      }
    };
    const item = parseOpenApi3(doc).find(i => i.path === '/x')!;
    expect(item.bodyParams).toEqual([
      {name: 'id', path: 'id', type: 'string', required: true}
    ]);
  });

  it('allOf 组合：子 schema 属性/required 与自身 properties 合并（继承场景）', () => {
    const doc: any = {
      openapi: '3.0.1',
      paths: {
        '/pet': {
          post: {
            summary: '创建宠物',
            requestBody: {
              content: {
                'application/json': {
                  schema: {$ref: '#/components/schemas/DogReq'}
                }
              }
            }
          }
        }
      },
      components: {
        schemas: {
          PetBase: {
            type: 'object',
            required: ['id'],
            properties: {id: {type: 'integer'}, name: {type: 'string'}}
          },
          DogReq: {
            allOf: [
              {$ref: '#/components/schemas/PetBase'},
              {
                type: 'object',
                required: ['breed'],
                properties: {breed: {type: 'string'}}
              }
            ]
          }
        }
      }
    };
    const item = parseOpenApi3(doc).find(i => i.path === '/pet')!;
    expect(item.bodyParams).toEqual([
      {name: 'id', path: 'id', type: 'integer', required: true},
      {name: 'name', path: 'name', type: 'string'},
      {name: 'breed', path: 'breed', type: 'string', required: true}
    ]);
  });

  it('requestBody 经 $ref 引用 components/requestBodies 时正常解析', () => {
    const doc: any = {
      openapi: '3.0.1',
      paths: {
        '/x': {
          post: {
            summary: 'X',
            requestBody: {$ref: '#/components/requestBodies/XBody'}
          }
        }
      },
      components: {
        requestBodies: {
          XBody: {
            content: {
              'application/json': {schema: {$ref: '#/components/schemas/XReq'}}
            }
          }
        },
        schemas: {
          XReq: {
            type: 'object',
            required: ['a'],
            properties: {a: {type: 'string'}}
          }
        }
      }
    };
    const item = parseOpenApi3(doc)[0];
    expect(item.bodyParams).toEqual([
      {name: 'a', path: 'a', type: 'string', required: true}
    ]);
  });

  it('组合 $ref 环不栈溢出（深度限制截断）', () => {
    const importItem = parseOpenApi3(openApi3Doc()).find(
      i => i.path === '/user/import'
    )!;
    // 钉住截断后的精确结构：允许 depth 0-5 共 6 层，最内层 a@'b.a.b.a.b.a' 不再下钻
    expect(importItem.bodyParams).toEqual([
      {
        name: 'b',
        path: 'b',
        type: 'object',
        children: [
          {
            name: 'a',
            path: 'b.a',
            type: 'object',
            children: [
              {
                name: 'b',
                path: 'b.a.b',
                type: 'object',
                children: [
                  {
                    name: 'a',
                    path: 'b.a.b.a',
                    type: 'object',
                    children: [
                      {
                        name: 'b',
                        path: 'b.a.b.a.b',
                        type: 'object',
                        children: [
                          {name: 'a', path: 'b.a.b.a.b.a', type: 'object'}
                        ]
                      },
                      {name: 'plain', path: 'b.a.b.a.plain', type: 'string'}
                    ]
                  }
                ]
              },
              {name: 'plain', path: 'b.a.plain', type: 'string'}
            ]
          }
        ]
      },
      {name: 'plain', path: 'plain', type: 'string'}
    ]);
  });

  it('trace 方法同样被遍历进列表', () => {
    const doc: any = {
      openapi: '3.0.1',
      paths: {'/x': {trace: {summary: 'TraceX'}}}
    };
    expect(parseOpenApi3(doc)).toEqual([
      {name: 'TraceX', method: 'trace', path: '/x'}
    ]);
  });

  it('pathItem 级与 operation 级 (name, in) 相同的参数去重，operation 覆盖 pathItem', () => {
    const doc: any = {
      openapi: '3.0.1',
      paths: {
        '/user/{id}': {
          parameters: [
            {name: 'id', in: 'path', required: true, schema: {type: 'integer'}},
            {name: 'verbose', in: 'query', schema: {type: 'boolean'}}
          ],
          get: {
            operationId: 'getUser',
            parameters: [
              {
                name: 'id',
                in: 'path',
                description: '主键',
                schema: {type: 'string'}
              },
              {
                name: 'verbose',
                in: 'query',
                required: true,
                schema: {type: 'boolean'}
              }
            ]
          }
        }
      }
    };
    const item = parseOpenApi3(doc)[0];
    // id 被 operation 级覆盖（string）；同名同 in 只出现一次
    expect(item.pathParams).toEqual([
      {name: 'id', type: 'string', path: 'id', description: '主键'}
    ]);
    expect(item.queryParams).toEqual([
      {name: 'verbose', type: 'boolean', required: true, path: 'verbose'}
    ]);
  });

  it('paths 缺失或非法时返回空数组', () => {
    expect(parseOpenApi3({openapi: '3.0.1'})).toEqual([]);
    expect(parseOpenApi3(null)).toEqual([]);
  });
});

/** 最小可用的 Swagger 2.0 文档 */
function swagger2Doc(): any {
  return {
    swagger: '2.0',
    basePath: '/api',
    paths: {
      '/pet': {
        post: {
          summary: '新增宠物',
          parameters: [
            {name: 'body', in: 'body', schema: {$ref: '#/definitions/Pet'}}
          ]
        }
      }
    },
    definitions: {
      Pet: {
        type: 'object',
        required: ['name'],
        properties: {name: {type: 'string'}, age: {type: 'integer'}}
      }
    }
  };
}

describe('apiPicker: parseSwagger2', () => {
  it('取 basePath 为前缀，in:body 参数经 definitions 解析', () => {
    const items = parseSwagger2(swagger2Doc());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: '新增宠物',
      method: 'post',
      path: '/pet',
      prefix: '/api'
    });
    expect(items[0].bodyParams).toEqual([
      {name: 'name', path: 'name', type: 'string', required: true},
      {name: 'age', path: 'age', type: 'integer'}
    ]);
  });
});
