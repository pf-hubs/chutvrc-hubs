import { ChannelHandlerContext, IChannelHandler } from "../channel-handler-interface";

/**
 * Handler priorities for avatar sync channels.
 * Lower values = higher priority (processed first).
 */
const AVATAR_SYNC_PRIORITY = 0;

/**
 * Note: Avatar transform channels (#avatar-RIG, #avatar-HEAD, #avatar-LEFT, #avatar-RIGHT)
 * are handled directly in the DataChannelMessageDispatcher via pattern matching.
 * They delegate to AvatarSyncHelper.handleRecvMessage() without needing separate handlers.
 */

/**
 * Handler for #avatarId channel.
 * Handles avatar asset ID synchronization between clients.
 *
 * Special behavior for SoraAdapter in public_speaking rooms:
 * Skips handling to avoid loading unnecessary avatar models.
 */
export class AvatarIdHandler implements IChannelHandler {
  readonly channelLabel = "#avatarId";
  readonly isMandatory = true;
  readonly priority = AVATAR_SYNC_PRIORITY;

  handleMessage(data: Uint8Array, context: ChannelHandlerContext): void {
    // Special handling for public_speaking rooms (SoraAdapter behavior)
    // Skip avatarId in public_speaking rooms to avoid loading unnecessary models
    if (context.roomId.includes("public_speaking")) {
      return;
    }

    context.avatarSyncHelper.handleRecvMessage(this.channelLabel, data);
  }
}

/**
 * Handler for #isVR channel.
 * Synchronizes VR/desktop mode flag between clients.
 */
export class IsVRHandler implements IChannelHandler {
  readonly channelLabel = "#isVR";
  readonly isMandatory = true;
  readonly priority = AVATAR_SYNC_PRIORITY;

  handleMessage(data: Uint8Array, context: ChannelHandlerContext): void {
    context.avatarSyncHelper.handleRecvMessage(this.channelLabel, data);
  }
}

/**
 * Handler for #avatarAnimState channel.
 * Synchronizes avatar animation state (stand, walk, sit) between clients.
 */
export class AvatarAnimStateHandler implements IChannelHandler {
  readonly channelLabel = "#avatarAnimState";
  readonly isMandatory = true;
  readonly priority = AVATAR_SYNC_PRIORITY;

  handleMessage(data: Uint8Array, context: ChannelHandlerContext): void {
    context.avatarSyncHelper.handleRecvMessage(this.channelLabel, data);
  }
}

/**
 * Factory to create all avatar sync handlers.
 * Note: Avatar transform channels are handled directly by the dispatcher.
 */
export function createAvatarSyncHandlers(): IChannelHandler[] {
  return [new AvatarIdHandler(), new IsVRHandler(), new AvatarAnimStateHandler()];
}

/**
 * Get the list of all avatar transform channel labels.
 */
export function getAvatarTransformChannelLabels(): string[] {
  return ["#avatar-RIG", "#avatar-HEAD", "#avatar-LEFT", "#avatar-RIGHT"];
}
