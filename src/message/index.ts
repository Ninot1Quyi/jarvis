export {
  MessageLayer,
  messageLayer,
  type MessageSource,
  type QueuedMessage,
  type ChatReply,
  type OutboundMailTarget,
  type OutboundMessage,
  type Deliverers,
} from './MessageLayer.js'

export {
  MailService,
  createMailService,
  type MailConfig,
} from './mail.js'

export {
  MessageManager,
  messageManager,
  type MessageManagerOptions,
} from './MessageManager.js'
