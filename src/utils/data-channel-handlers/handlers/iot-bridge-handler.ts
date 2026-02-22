import { ChannelHandlerContext, IChannelHandler } from "../channel-handler-interface";

/**
 * Handler for #iot channel.
 * Handles IoT device bridge communication.
 *
 * This handler delegates to the adapter's processBridgeChannelMessage method
 * which handles deserialization and callback invocation for bridge messages.
 *
 * Supported by: DialogAdapter, SoraAdapter
 */
export class IotBridgeHandler implements IChannelHandler {
  readonly channelLabel = "#iot";
  readonly isMandatory = false;
  readonly priority = 100; // Lower priority (processed later)

  handleMessage(data: Uint8Array, context: ChannelHandlerContext): void {
    // Delegate to the adapter's bridge message processing
    // The adapter implements BridgeCapable interface
    context.adapter.processBridgeChannelMessage(data.buffer as ArrayBuffer);
  }
}
