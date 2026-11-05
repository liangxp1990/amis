/**
 * @file ai-chat 渲染器:schema → amis-ui Chat 组合件的薄壳。
 * 只做四件事:endpoint/context 模板解析、env.aguiFetcher 注入、
 * 数据域联动(STATE 写回)、amis 事件派发;UI 一律在 amis-ui Chat 内。
 */
import React from 'react';
import {
  AMISSchemaBase,
  Renderer,
  RendererProps,
  dataMapping,
  defaultAguiFetcher,
  isPureVariable,
  resolveVariableAndFilter
} from 'amis-core';
import type {AguiTool, ChatMessage} from 'amis-core';
// 同步引入:Chat 组合件体积小且依赖(Markdown)本就是 amis 主包依赖
import {Chat} from 'amis-ui';

/** 角色展示配置(名称/头像) */
export interface AMISAIChatRoleSchema {
  name?: string;
  avatar?: string;
}

/**
 * ai-chat 组件:AG-UI 协议的 AI 对话组件。
 * 详见 docs/zh-CN/components/ai-chat.md。
 */
export interface AMISAIChatSchema extends AMISSchemaBase {
  /** 指定为 ai-chat 组件 */
  type: 'ai-chat';

  /** AG-UI 端点(POST RunAgentInput,返回 SSE 事件流),支持 ${xxx} 模板 */
  endpoint?: string;

  /** 欢迎语(markdown) */
  welcome?: string;

  /** 空态提示语,点击即作为消息发送 */
  hints?: string[];

  /** 角色展示配置 */
  roles?: {
    user?: AMISAIChatRoleSchema;
    assistant?: AMISAIChatRoleSchema;
    system?: AMISAIChatRoleSchema;
  };

  /** 布局模式:全部气泡(bubble)/仅用户气泡(userBubble)/无气泡(noBubble) */
  mode?: 'bubble' | 'noBubble' | 'userBubble';

  /**
   * 发送时从数据域映射业务上下文,进 RunAgentInput.context。
   * 支持对象({key: '${xxx}'})或键值数组([{key, value}]——编辑器
   * combo 控件的可视化产出,发送前归一化)。
   * 注:字段不能叫 context——那是 amis 顶层 schema 的保留概念
   * (RootRenderer 会用它下发 store.context,同名会被覆盖)。
   */
  agentContext?: Record<string, any> | Array<{key: string; value?: any}>;

  /** Agent 状态写回数据域时的 key,默认 aiChatState */
  stateKey?: string;

  /** 暴露给 Agent 的工具描述 */
  tools?: AguiTool[];

  /** 是否渲染思考过程,默认 true */
  showThinking?: boolean;

  /** 是否渲染工具调用卡片,默认 true */
  showToolCalls?: boolean;

  /** 是否显示停止生成按钮,默认 true */
  showStop?: boolean;

  /** 发送快捷键,默认 enter */
  sendHotKey?: 'enter' | 'shift+enter';

  placeholder?: string;

  /** 初始消息(如从接口恢复会话) */
  initialMessages?: ChatMessage[];

  /** 禁用输入 */
  disabled?: boolean;
}

export interface AIChatProps
  extends RendererProps,
    Omit<AMISAIChatSchema, 'type' | 'className'> {}

/**
 * 编辑器 combo 控件产出的键值数组归一化为映射对象。
 *
 * @param ctx 对象或 [{key, value}] 数组
 */
function normalizeAgentContext(
  ctx: Record<string, any> | Array<{key: string; value?: any}>
): Record<string, any> {
  if (!Array.isArray(ctx)) {
    return ctx;
  }
  const acc: Record<string, any> = {};
  for (const item of ctx) {
    if (item?.key) {
      acc[item.key] = item.value ?? '';
    }
  }
  return acc;
}

/**
 * ai-chat 渲染器实现。
 * 事件:sendMessage / finish / error / stateChange 均可被 onEvent 监听。
 */
export class AIChat extends React.Component<AIChatProps> {
  handleStateUpdate = (state: any) => {
    const {stateKey = 'aiChatState', onBulkChange, dispatchEvent} = this.props;
    // form 上下文内直接写数据域;其余场景通过 stateChange 事件用动作链接收
    onBulkChange?.({[stateKey]: state});
    dispatchEvent('stateChange', {[stateKey]: state, value: state});
  };

  render() {
    const {endpoint, agentContext, data, env, className, dispatchEvent} =
      this.props;

    // endpoint 支持 ${xxx} 纯变量模板
    const finalEndpoint = isPureVariable(endpoint)
      ? resolveVariableAndFilter(endpoint, data, '| raw')
      : endpoint;

    // agentContext 支持数据映射(如 {userId: '${user.id}'}),兼容编辑器数组格式
    const finalContext = agentContext
      ? dataMapping(normalizeAgentContext(agentContext), data)
      : undefined;

    return (
      <Chat
        {...this.props}
        className={className}
        endpoint={finalEndpoint}
        context={finalContext}
        fetcher={env?.aguiFetcher ?? defaultAguiFetcher}
        onSendMessage={(text: string) =>
          dispatchEvent('sendMessage', {text, ...data})
        }
        onRegenerate={() => dispatchEvent('regenerate', data)}
        onFinish={() => dispatchEvent('finish', data)}
        onError={(message: string) =>
          dispatchEvent('error', {message, ...data})
        }
        onStateUpdate={this.handleStateUpdate}
      />
    );
  }
}

@Renderer({
  type: 'ai-chat'
})
export class AIChatRenderer extends AIChat {}
