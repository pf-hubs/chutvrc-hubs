import { SfuAdapter } from "../../sfu-adapters/sfu-adapter";
import { PoseSync } from "../../avatar/net/pose-sync";
import { ChannelHandlerContext, IChannelHandler } from "./channel-handler-interface";
import { ChannelHandlerRegistry } from "./channel-handler-registry";

/**
 * Dispatches data channel messages to appropriate handlers.
 */
export class DataChannelMessageDispatcher {
  private registry: ChannelHandlerRegistry;
  private context: ChannelHandlerContext;

  constructor(
    adapter: SfuAdapter,
    poseSync: PoseSync,
    registry: ChannelHandlerRegistry
  ) {
    this.registry = registry;
    this.context = {
      adapter,
      clientId: adapter.clientId,
      roomId: adapter.roomId,
      textDecoder: new TextDecoder(),
      textEncoder: new TextEncoder(),
      poseSync
    };
  }

  /**
   * Update context when client/room info changes (e.g., after connect).
   */
  updateContext(clientId: string, roomId: string): void {
    this.context.clientId = clientId;
    this.context.roomId = roomId;
  }

  /**
   * Dispatch a message to the appropriate handler.
   *
   * @param channelLabel The channel label (e.g., "#nimpro")
   * @param data The raw message data
   */
  dispatchMessage(channelLabel: string, data: ArrayBuffer): void {
    const uint8Data = new Uint8Array(data);

    // Find and invoke handler
    const handler = this.registry.getHandler(channelLabel);
    if (handler) {
      try {
        handler.handleMessage(uint8Data, this.context);
      } catch (error) {
        console.error(`Error in handler for channel ${channelLabel}:`, error);
      }
      return;
    }

    // Check for the pose channels (pattern: #avatar-*: #avatar-pose and the old per-part channels)
    if (channelLabel.startsWith("#avatar-")) {
      // Delegate the pose channels to the pose sync, which tells the whole-body packets from the per-part ones
      this.context.poseSync.handleRecvMessage(channelLabel, uint8Data);
      return;
    }

    // No handler found - this is not necessarily an error, just unhandled
    // console.debug(`No handler registered for channel: ${channelLabel}`);
  }

  /**
   * Notify handlers that a channel is ready.
   * Called when a data channel is opened.
   */
  notifyChannelReady(channelLabel: string): void {
    const handler = this.registry.getHandler(channelLabel);
    if (handler?.onChannelReady) {
      try {
        handler.onChannelReady(this.context);
      } catch (error) {
        console.error(`Error in onChannelReady for channel ${channelLabel}:`, error);
      }
    }
  }

  /**
   * Cleanup all handlers on disconnect.
   */
  cleanup(): void {
    for (const handler of this.registry.getAllHandlersSorted()) {
      if (handler.onDisconnect) {
        try {
          handler.onDisconnect(this.context);
        } catch (error) {
          console.error(`Error in onDisconnect for channel ${handler.channelLabel}:`, error);
        }
      }
    }
  }

  /**
   * Get the handler registry.
   */
  getRegistry(): ChannelHandlerRegistry {
    return this.registry;
  }
}
