import { ChannelHandlerContext, IChannelHandler } from "../channel-handler-interface";

/**
 * Handler for #emoji channel.
 * Handles emoji reaction messages.
 *
 * Message format: Emoji identifier or reaction data as text.
 *
 * Supported by: SoraAdapter only
 *
 * TODO: Implement full emoji reaction system.
 * Currently just logs and emits an event.
 */
export class EmojiHandler implements IChannelHandler {
  readonly channelLabel = "#emoji";
  readonly isMandatory = false;
  readonly priority = 50;

  handleMessage(data: Uint8Array, context: ChannelHandlerContext): void {
    const message = context.textDecoder.decode(data);

    // Log for debugging (matching original behavior)
    console.log("Emoji received!", message);

    // Emit event for emoji reaction system to handle
    context.adapter.emit("emoji-received", {
      message
    });
  }
}
