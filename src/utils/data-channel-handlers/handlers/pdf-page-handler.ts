import { ChannelHandlerContext, IChannelHandler } from "../channel-handler-interface";

/**
 * Handler for #pdfPage channel.
 * Handles PDF viewer page synchronization in public speaker rooms.
 *
 * Message format: Page number or navigation command as text.
 *
 * Supported by: SoraAdapter only
 */
export class PdfPageHandler implements IChannelHandler {
  readonly channelLabel = "#pdfPage";
  readonly isMandatory = false;
  readonly priority = 20;

  handleMessage(data: Uint8Array, context: ChannelHandlerContext): void {
    const message = context.textDecoder.decode(data);

    // Emit event for PDF viewer component to handle
    context.adapter.emit("pdf-page-changed-in-public-speaker-room", {
      message
    });
  }
}
