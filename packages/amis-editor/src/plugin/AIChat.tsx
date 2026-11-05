/**
 * @file ai-chat 编辑器插件:可视化配置 AI 对话组件(AG-UI 协议)。
 *
 * 面板全控件化(零 JSON 手输):
 * - 常规:端点/欢迎语/提示语数组/占位符/快捷键/功能开关
 * - 角色:用户与助手名称、头像
 * - 数据联动:agentContext 键值对(combo)+ stateKey
 * - 外观:布局模式/类名
 * - 事件:sendMessage/finish/error/stateChange 标准事件面板
 */
import {registerEditorPlugin} from 'amis-editor-core';
import {
  BaseEventContext,
  BasePlugin,
  RendererPluginEvent,
  defaultValue,
  getSchemaTpl,
  tipedLabel
} from 'amis-editor-core';
import {getEventControlConfig} from '../renderer/event-control/helper';

export class AIChatPlugin extends BasePlugin {
  static id = 'AIChatPlugin';
  static scene = ['layout'];
  // 关联渲染器名字,必须与 amis 渲染器注册的 type 一致
  rendererName = 'ai-chat';
  $schema = '/schemas/AMISAIChatSchema.json';

  name = 'AI 对话';
  isBaseComponent = true;
  description =
    '基于 AG-UI 协议的 AI 对话组件:流式回复/思考过程/工具调用/数据域联动';
  docLink = '/amis/zh-CN/components/ai-chat';
  tags = ['展示', '功能'];
  icon = 'fa fa-comments';
  pluginIcon = 'chat-plugin';

  scaffold = {
    type: 'ai-chat',
    endpoint: '/amis-agent/chat',
    welcome: '你好，我是 AI 助手，请问有什么可以帮你？',
    hints: ['开始对话吧']
  };
  previewSchema = {
    ...this.scaffold,
    style: {height: 260}
  };

  // 事件定义(dataSchema 描述事件数据,供动作链引用)
  events: RendererPluginEvent[] = [
    {
      eventName: 'sendMessage',
      eventLabel: '发送消息',
      description: '用户发送消息时触发',
      dataSchema: [
        {
          type: 'object',
          properties: {
            'event.data.text': {
              type: 'string',
              title: '消息内容'
            }
          }
        }
      ]
    },
    {
      eventName: 'finish',
      eventLabel: '回答完成',
      description: '一轮回答(RUN_FINISHED)结束时触发'
    },
    {
      eventName: 'error',
      eventLabel: '运行出错',
      description: 'Agent 运行出错时触发',
      dataSchema: [
        {
          type: 'object',
          properties: {
            'event.data.message': {
              type: 'string',
              title: '错误信息'
            }
          }
        }
      ]
    },
    {
      eventName: 'stateChange',
      eventLabel: '状态变化',
      description: 'Agent 状态(STATE_SNAPSHOT/DELTA)更新时触发',
      dataSchema: [
        {
          type: 'object',
          properties: {
            'event.data.value': {
              type: 'object',
              title: '最新 Agent 状态'
            }
          }
        }
      ]
    }
  ];

  panelTitle = 'AI 对话';
  panelJustify = true;

  panelBodyCreator = (context: BaseEventContext) => {
    const isUnderField = /\/field\/\w+$/.test(context.path as string);
    return [
      getSchemaTpl('tabs', [
        {
          title: '常规',
          body: [
            getSchemaTpl('collapseGroup', [
              {
                title: '基础设置',
                body: [
                  getSchemaTpl('layout:originPosition', {value: 'left-top'}),
                  {
                    name: 'endpoint',
                    type: 'input-text',
                    required: true,
                    label: tipedLabel(
                      '服务端点',
                      'AG-UI 协议端点(POST RunAgentInput,返回 SSE 事件流),支持 ${xxx} 模板'
                    ),
                    placeholder: '/amis-agent/chat'
                  },
                  {
                    name: 'welcome',
                    type: 'textarea',
                    label: tipedLabel(
                      '欢迎语',
                      'markdown 格式,显示为首条助手消息'
                    ),
                    placeholder: '你好，我是 AI 助手'
                  },
                  {
                    name: 'hints',
                    type: 'input-array',
                    label: tipedLabel(
                      '提示语',
                      '空态快捷输入,点击即作为消息发送'
                    ),
                    multiple: true,
                    addable: true,
                    removable: true,
                    items: getSchemaTpl('inputArrayItem')
                  },
                  {
                    name: 'placeholder',
                    type: 'input-text',
                    label: '输入框占位符',
                    placeholder: '输入消息…'
                  }
                ]
              },
              {
                title: '角色显示',
                body: [
                  {
                    name: 'roles.user.name',
                    type: 'input-text',
                    label: '用户名称',
                    placeholder: '我'
                  },
                  {
                    name: 'roles.assistant.name',
                    type: 'input-text',
                    label: '助手名称',
                    placeholder: '助手'
                  },
                  {
                    name: 'roles.assistant.avatar',
                    type: 'input-text',
                    label: tipedLabel('助手头像', '图片 URL,留空显示名称首字')
                  }
                ]
              },
              {
                title: '数据联动',
                body: [
                  {
                    name: 'agentContext',
                    type: 'combo',
                    label: tipedLabel(
                      '上下文映射',
                      '发送消息时随请求上报给 Agent 的业务上下文,值支持 ${xxx} 取页面数据'
                    ),
                    multiple: true,
                    addable: true,
                    removable: true,
                    draggable: true,
                    items: [
                      {
                        name: 'key',
                        type: 'input-text',
                        placeholder: '字段名',
                        required: true,
                        columnRatio: 2
                      },
                      {
                        name: 'value',
                        type: 'input-text',
                        placeholder: '${xxx} 或固定值',
                        columnRatio: 3
                      }
                    ]
                  },
                  {
                    name: 'stateKey',
                    type: 'input-text',
                    label: tipedLabel(
                      '状态变量名',
                      'Agent 状态写回数据域的变量名,页面其他组件可用 ${变量名} 联动,默认 aiChatState'
                    ),
                    placeholder: 'aiChatState',
                    clearable: true
                  }
                ]
              },
              {
                title: '功能开关',
                body: [
                  getSchemaTpl('switch', {
                    name: 'showThinking',
                    label: '展示思考过程',
                    value: true,
                    pipeIn: defaultValue(true)
                  }),
                  getSchemaTpl('switch', {
                    name: 'showToolCalls',
                    label: '展示工具调用',
                    value: true,
                    pipeIn: defaultValue(true)
                  }),
                  getSchemaTpl('switch', {
                    name: 'showStop',
                    label: '允许停止生成',
                    value: true,
                    pipeIn: defaultValue(true)
                  }),
                  {
                    name: 'sendHotKey',
                    type: 'select',
                    label: '发送快捷键',
                    placeholder: 'Enter 发送 / Shift+Enter 换行',
                    options: [
                      {label: 'Enter 发送 / Shift+Enter 换行', value: 'enter'},
                      {
                        label: 'Shift+Enter 发送 / Enter 换行',
                        value: 'shift+enter'
                      }
                    ],
                    clearable: true
                  }
                ]
              }
            ])
          ]
        },
        {
          title: '外观',
          body: [
            getSchemaTpl('collapseGroup', [
              {
                title: '布局',
                body: [
                  {
                    name: 'mode',
                    type: 'select',
                    label: '布局模式',
                    options: [
                      {label: '全部气泡', value: 'bubble'},
                      {label: '仅用户气泡', value: 'userBubble'},
                      {label: '无气泡', value: 'noBubble'}
                    ],
                    clearable: true
                  },
                  getSchemaTpl('className', {label: '外层类名'})
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
      ])
    ];
  };
}

registerEditorPlugin(AIChatPlugin);
