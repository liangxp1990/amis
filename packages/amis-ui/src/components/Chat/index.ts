/**
 * @file Chat 组件族出口。Chat 为组合件(普通 React 可直接使用)。
 * ChatMessage/ChatInput 零件不从包根导出(避免与 amis-core 的
 * ChatMessage 类型重名冲突),需要时从 'amis-ui/lib/components/Chat' 引用。
 */
export {Chat} from './Chat';
export type {ChatProps, ChatRoleMeta} from './Chat';
