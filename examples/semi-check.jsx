/**
 * @file semi 主题全组件核对页
 * 用 embed 以 theme: 'semi' 渲染核心组件的全状态组合，
 * 供与 Semi Design 官方视觉规范逐一核对。
 */
import {embed} from './embed';

const schema = {
  type: 'page',
  title: 'Semi 主题 · 组件全览核对',
  body: [
    {
      type: 'tpl',
      tpl: '<div class="check-section"><div class="check-title">1. 按钮 Button（primary/secondary/success/warning/danger/light/link + 尺寸 + 禁用）</div></div>'
    },
    {
      type: 'button-group',
      buttons: [
        {type: 'action', label: '主要按钮', actionType: '', level: 'primary'},
        {type: 'action', label: '次要按钮'},
        {type: 'action', label: '成功', level: 'success'},
        {type: 'action', label: '警告', level: 'warning'},
        {type: 'action', label: '危险', level: 'danger'},
        {type: 'action', label: '浅色', level: 'light'},
        {type: 'action', label: '链接', level: 'link'},
        {type: 'action', label: '增强', level: 'enhance'},
        {type: 'action', label: '禁用', level: 'primary', disabled: true},
        {type: 'action', label: '小尺寸', size: 'sm', level: 'primary'},
        {type: 'action', label: '大尺寸', size: 'lg', level: 'primary'}
      ]
    },
    {
      type: 'tpl',
      tpl: '<div class="check-section"><div class="check-title">2. 表单 Form（input/select/checkbox/radio/switch/number/tag/date/textarea + 校验态）</div></div>'
    },
    {
      type: 'form',
      title: '',
      mode: 'horizontal',
      wrapWithPanel: false,
      body: [
        {type: 'input-text', name: 'a', label: '文本', placeholder: '请输入'},
        {
          type: 'input-text',
          name: 'b',
          label: '错误态',
          value: '内容',
          className: 'is-error'
        },
        {
          type: 'input-text',
          name: 'c',
          label: '禁用态',
          value: '不可编辑',
          disabled: true
        },
        {
          type: 'select',
          name: 'd',
          label: '选择器',
          options: ['选项 A', '选项 B', '选项 C'],
          placeholder: '请选择'
        },
        {type: 'input-number', name: 'e', label: '数字', value: 10},
        {
          type: 'switch',
          name: 'f',
          label: '开关',
          option: '开关说明'
        },
        {type: 'checkbox', name: 'g', label: '勾选', option: '同意协议'},
        {
          type: 'radios',
          name: 'h',
          label: '单选',
          options: ['甲', '乙', '丙']
        },
        {
          type: 'input-tag',
          name: 'i',
          label: '标签输入',
          value: 'a,b',
          options: ['a', 'b', 'c']
        },
        {
          type: 'input-date-range',
          name: 'j',
          label: '日期区间',
          placeholder: '开始 ~ 结束'
        },
        {
          type: 'textarea',
          name: 'k',
          label: '多行',
          placeholder: '多行文本'
        },
        {
          type: 'rating',
          name: 'l',
          label: '评分',
          value: 3
        }
      ]
    },
    {
      type: 'tpl',
      tpl: '<div class="check-section"><div class="check-title">3. 提示 Alert / Toast 色 / 徽标 Badge / 标签 Tag</div></div>'
    },
    {
      type: 'grid',
      columns: [
        {
          body: [
            {type: 'alert', level: 'info', body: '信息提示 info'},
            {type: 'alert', level: 'success', body: '成功提示 success'},
            {type: 'alert', level: 'warning', body: '警告提示 warning'},
            {type: 'alert', level: 'danger', body: '危险提示 danger'}
          ]
        },
        {
          body: [
            {
              type: 'tpl',
              tpl: '<span class="label label-primary">主要</span> <span class="label label-success">成功</span> <span class="label label-warning">警告</span> <span class="label label-danger">危险</span> <span class="badge">9</span>'
            },
            {
              type: 'tag',
              label: '默认',
              displayMode: 'normal'
            },
            {type: 'tag', label: '进行中', displayMode: 'active'},
            {type: 'tag', label: '成功', displayMode: 'success'},
            {type: 'tag', label: '出错', displayMode: 'error'},
            {type: 'tag', label: '警告', displayMode: 'warning'}
          ]
        }
      ]
    },
    {
      type: 'tpl',
      tpl: '<div class="check-section"><div class="check-title">4. Tabs / 步骤条 / 进度条 / 分页（静态）</div></div>'
    },
    {
      type: 'tabs',
      tabs: [
        {title: '页签一', body: '内容一'},
        {title: '页签二', body: '内容二'},
        {title: '页签三', body: '内容三'}
      ]
    },
    {
      type: 'steps',
      steps: [
        {title: '已完成', subTitle: '08:00'},
        {title: '进行中', subTitle: '10:00'},
        {title: '待进行', subTitle: '12:00'}
      ],
      value: 1,
      className: 'm-b'
    },
    {
      type: 'grid',
      columns: [
        {
          body: [
            {type: 'progress', value: 40, showLabel: true, mode: 'line'},
            {type: 'progress', value: 70, mode: 'circle', showLabel: true}
          ]
        },
        {
          body: [
            {
              type: 'pagination',
              total: 100,
              activePage: 3,
              perPage: 10,
              mode: 'simple'
            }
          ]
        }
      ]
    },
    {
      type: 'tpl',
      tpl: '<div class="check-section"><div class="check-title">5. 表格 CRUD（表头/边框/斑马纹/操作链接）</div></div>'
    },
    {
      type: 'crud',
      syncLocation: false,
      api: {
        method: 'get',
        url: '/api/mock2/sample',
        mockResponse: {
          status: 0,
          data: {
            items: [
              {id: 1, name: '张三', status: 1, score: 86},
              {id: 2, name: '李四', status: 0, score: 72},
              {id: 3, name: '王五', status: 1, score: 95}
            ],
            total: 3
          }
        }
      },
      columns: [
        {name: 'id', label: 'ID'},
        {name: 'name', label: '姓名'},
        {
          name: 'status',
          label: '状态',
          type: 'mapping',
          map: {
            1: '<span class="label label-success">启用</span>',
            0: '<span class="label label-warning">停用</span>'
          }
        },
        {
          type: 'operation',
          label: '操作',
          buttons: [
            {type: 'button', label: '编辑', level: 'link'},
            {type: 'button', label: '删除', level: 'link', className: 'text-danger'}
          ]
        }
      ]
    },
    {
      type: 'tpl',
      tpl: '<div class="check-section"><div class="check-title">6. 弹层（点击逐个触发核对）</div></div>'
    },
    {
      type: 'button-group',
      buttons: [
        {
          type: 'action',
          label: 'Toast 成功',
          level: 'primary',
          actionType: 'toast',
          toast: {items: [{title: '保存成功', body: '内容已提交', level: 'success'}]}
        },
        {
          type: 'action',
          label: 'Toast 警告',
          level: 'warning',
          actionType: 'toast',
          toast: {items: [{title: '注意', body: '余额不足', level: 'warning'}]}
        },
        {
          type: 'button',
          label: '打开 Dialog',
          level: 'primary',
          actionType: 'dialog',
          dialog: {
            title: '弹窗标题',
            body: 'Semi Modal：圆角 12px、蒙层 rgba(22,22,26,.6)',
            actions: [
              {type: 'button', label: '取消', actionType: 'close'},
              {type: 'button', label: '确定', level: 'primary', actionType: 'close'}
            ]
          }
        },
        {
          type: 'button',
          label: '打开 Drawer',
          actionType: 'drawer',
          drawer: {
            title: '抽屉标题',
            body: 'Semi SideSheet：蒙层 rgba(22,22,26,.6)',
            actions: [{type: 'button', label: '关闭', actionType: 'close'}]
          }
        }
      ]
    },
    {
      type: 'tpl',
      tpl: '<div class="check-section"><div class="check-title">7. Tooltip / 卡片 Card / 下拉按钮 / 链接</div></div>'
    },
    {
      type: 'form',
      wrapWithPanel: false,
      body: [
        {
          type: 'input-text',
          name: 'tip',
          label: '悬停看 Tooltip',
          placeholder: '鼠标悬停问号',
          remark: 'Semi Tooltip：grey-7 底、白字、圆角 6px'
        }
      ]
    },
    {
      type: 'grid',
      columns: [
        {
          body: {
            type: 'card',
            header: {title: '卡片标题', subTitle: '副标题'},
            body: '卡片内容，圆角应为 3px，边框 #ECEDEE',
            actions: [{type: 'button', label: '操作', level: 'primary'}]
          }
        },
        {
          body: [
            {
              type: 'dropdown-button',
              label: '下拉菜单',
              buttons: [
                {type: 'button', label: '菜单一'},
                {type: 'button', label: '菜单二'}
              ]
            },
            {type: 'link', href: '#', body: '这是一个链接（应为 #0064FA）'}
          ]
        }
      ]
    }
  ]
};

embed('#root', schema, {}, {theme: 'semi'});
