// Core infrastructure
export type { IChannelHandler, ChannelHandlerContext, ChannelHandlerConstructor } from "./channel-handler-interface";
export { ChannelHandlerRegistry, globalChannelHandlerRegistry } from "./channel-handler-registry";
export { DataChannelMessageDispatcher } from "./message-dispatcher";

// Handler implementations
export * from "./handlers";
