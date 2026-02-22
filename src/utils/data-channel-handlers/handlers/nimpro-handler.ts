import { ChannelHandlerContext, IChannelHandler } from "../channel-handler-interface";
import { NimproSystem } from "../../../systems/nimpro-system";

/**
 * Handler for #nimpro channel.
 * Handles Nimpro game integration messages.
 *
 * Message format: "messageType|seatNum|value"
 * - messageType: "assigned", "stat", "pID", "ans", "point", "buttonVis"
 * - seatNum: Seat number in the game
 * - value: Context-dependent value
 *
 * Supported by: DialogAdapter, SoraAdapter
 */
export class NimproHandler implements IChannelHandler {
  readonly channelLabel = "#nimpro";
  readonly isMandatory = false;
  readonly priority = 10;

  handleMessage(data: Uint8Array, context: ChannelHandlerContext): void {
    const decodedMessage = context.textDecoder.decode(data);
    const [messageType, seatNum, value] = decodedMessage.split("|");

    // Handle seat assignment for local client
    if (messageType === "assigned" && value === context.clientId) {
      NimproSystem.joinGame(false, seatNum);
    }

    // Emit event for other components to handle
    context.adapter.emit("nimpro_message_received", {
      label: this.channelLabel,
      message: decodedMessage
    });
  }
}
