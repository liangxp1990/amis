/**
 * @file Captcha 行为验证码的编辑器插件。
 *
 * 让 captcha 渲染器（packages/amis/src/renderers/Form/Captcha.tsx）在编辑器
 * 左侧组件面板可见、可拖入表单，并提供属性/事件/动作的可视化配置。
 * 协议为 AJ-Captcha：getApi/checkApi 默认指向其标准端点。
 */
import {
  EditorNodeType,
  RAW_TYPE_MAP,
  defaultValue,
  getSchemaTpl,
  registerEditorPlugin,
  BasePlugin,
  BaseEventContext,
  RendererPluginAction,
  RendererPluginEvent,
  tipedLabel
} from 'amis-editor-core';
import {
  getEventControlConfig,
  getActionCommonProps
} from '../../renderer/event-control/helper';

export class CaptchaControlPlugin extends BasePlugin {
  static id = 'CaptchaControlPlugin';
  static scene = ['layout'];
  // 关联渲染器名字
  rendererName = 'captcha';
  $schema = '/schemas/AMISCaptchaSchema.json';

  // 组件名称
  name = '行为验证码';
  isBaseComponent = true;
  icon = 'fa fa-shield';
  description = '行为验证码，支持滑动拼图、滑块曲线、点选文字（AJ-Captcha 协议）';
  docLink = '/amis/zh-CN/components/form/captcha';
  tags = ['表单项'];
  scaffold = {
    type: 'captcha',
    label: '验证码',
    name: 'captcha',
    // 指向本仓库 mock，拖入画布即可看到真实效果；对接真实后端时改掉即可
    getApi: 'post:/api/mock2/captcha/get',
    checkApi: 'post:/api/mock2/captcha/check'
  };
  previewSchema: any = {
    type: 'form',
    className: 'text-left',
    mode: 'horizontal',
    wrapWithPanel: false,
    body: [{...this.scaffold}]
  };

  notRenderFormZone = true;

  panelTitle = '验证码';

  // 事件定义
  events: RendererPluginEvent[] = [
    {
      eventName: 'change',
      eventLabel: '值变化',
      description: '验证通过写入值（或重新验证清空值）时触发',
      dataSchema: [
        {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              title: '数据',
              properties: {
                value: {
                  type: 'string',
                  title: '二次校验凭证'
                }
              }
            }
          }
        }
      ]
    },
    {
      eventName: 'success',
      eventLabel: '验证成功',
      description: '行为校验通过时触发',
      dataSchema: [
        {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              title: '数据',
              properties: {
                captchaVerification: {
                  type: 'string',
                  title: '二次校验凭证'
                },
                token: {
                  type: 'string',
                  title: '本次验证 token'
                },
                captchaType: {
                  type: 'string',
                  title: '验证码类型'
                }
              }
            }
          }
        }
      ]
    },
    {
      eventName: 'fail',
      eventLabel: '验证失败',
      description: '行为校验失败时触发',
      dataSchema: [
        {
          type: 'object',
          properties: {
            data: {
              type: 'object',
              title: '数据',
              properties: {
                msg: {
                  type: 'string',
                  title: '失败原因'
                }
              }
            }
          }
        }
      ]
    }
  ];

  // 动作定义（与组件 doAction 实现一一对应）
  actions: RendererPluginAction[] = [
    {
      actionType: 'open',
      actionLabel: '打开验证',
      description:
        '唤起弹出验证（仅弹出形态；已验证时先清值并重新出一局），可由"发送短信"等外部按钮触发',
      ...getActionCommonProps('open')
    },
    {
      actionType: 'refresh',
      actionLabel: '刷新验证码',
      description: '重新出一局验证码',
      ...getActionCommonProps('refresh')
    },
    {
      actionType: 'clear',
      actionLabel: '清空',
      description: '清空已验证的值并刷新',
      ...getActionCommonProps('clear')
    },
    {
      actionType: 'reset',
      actionLabel: '重置',
      description: '将值重置为初始值并刷新',
      ...getActionCommonProps('reset')
    }
  ];

  panelJustify = true;
  panelBodyCreator = (context: BaseEventContext) => {
    return getSchemaTpl('tabs', [
      {
        title: '属性',
        body: getSchemaTpl('collapseGroup', [
          {
            title: '基本',
            body: [
              getSchemaTpl('layout:originPosition', {value: 'left-top'}),
              getSchemaTpl('formItemName', {
                required: true
              }),
              getSchemaTpl('label'),
              {
                type: 'select',
                label: '验证码类型',
                name: 'captchaType',
                value: 'blockPuzzle',
                options: [
                  {label: '滑动拼图', value: 'blockPuzzle'},
                  {label: '滑块曲线', value: 'curveSlider'},
                  {label: '点选文字', value: 'clickWord'}
                ]
              },
              {
                type: 'select',
                label: '展示形态',
                name: 'displayMode',
                value: 'embed',
                options: [
                  {label: '内嵌', value: 'embed'},
                  {label: '弹出', value: 'popup'}
                ]
              },
              {
                type: 'input-text',
                label: '触发按钮文案',
                name: 'actionText',
                visibleOn:
                  'this.displayMode === "popup" && this.hideTrigger !== true',
                pipeIn: defaultValue('点击进行验证')
              },
              {
                type: 'switch',
                label: tipedLabel(
                  '隐藏触发按钮',
                  '由外部组件通过组件动作 <code>open</code> 唤起弹出验证（如"发送短信"按钮）'
                ),
                name: 'hideTrigger',
                visibleOn: 'this.displayMode === "popup"'
              },
              {
                type: 'input-number',
                label: '显示宽度',
                name: 'width',
                min: 260,
                max: 640,
                step: 10,
                pipeIn: defaultValue(310),
                description: '图片按 2:1 等比显示，默认 310px'
              },
              getSchemaTpl('remark'),
              getSchemaTpl('labelRemark')
            ]
          },
          {
            title: '接口',
            body: [
              getSchemaTpl('apiControl', {
                mode: 'row',
                name: 'getApi',
                label: tipedLabel(
                  '获取验证码',
                  'AJ-Captcha 协议 <code>/captcha/get</code>，返回底图、拼图条/曲线参数、token 与 secretKey'
                ),
                value: 'post:/captcha/get'
              }),
              getSchemaTpl('apiControl', {
                mode: 'row',
                name: 'checkApi',
                label: tipedLabel(
                  '行为校验',
                  'AJ-Captcha 协议 <code>/captcha/check</code>，校验用户提交的加密行为轨迹'
                ),
                value: 'post:/captcha/check'
              })
            ]
          },
          getSchemaTpl('status', {isFormItem: true})
        ])
      },
      {
        title: '外观',
        body: [
          getSchemaTpl('collapseGroup', [
            {
              title: 'CSS 类名',
              body: [
                getSchemaTpl('className', {
                  label: '外层'
                })
              ]
            }
          ])
        ]
      },
      {
        title: '事件',
        className: 'p-none',
        body: [
          getSchemaTpl('eventControl', {
            name: 'onEvent',
            ...getEventControlConfig(this.manager, context)
          })
        ]
      }
    ]);
  };

  buildDataSchemas(node: EditorNodeType, region: EditorNodeType) {
    return {
      type: 'string',
      title: node.schema?.label || node.schema?.name,
      rawType: RAW_TYPE_MAP[node.schema.type as any] || 'string',
      originalValue: node.schema?.value
    };
  }
}

registerEditorPlugin(CaptchaControlPlugin);
