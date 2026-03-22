import { ChannelHandlerContext, IChannelHandler } from "../channel-handler-interface";

/**
 * Handler for #togglePublicSpeaker channel.
 * Handles public speaker mode toggle events.
 *
 * Message format: Toggle command as text.
 *
 * Supported by: SoraAdapter only (SENDRECV mode)
 */
export class TogglePublicSpeakerHandler implements IChannelHandler {
  readonly channelLabel = "#togglePublicSpeaker";
  readonly isMandatory = false;
  readonly priority = 20;

  handleMessage(data: Uint8Array, context: ChannelHandlerContext): void {
    const message = context.textDecoder.decode(data);

    // Emit event for public speaker system to handle
    context.adapter.emit("toggle-public-speaker", {
      message
    });
  }
}
