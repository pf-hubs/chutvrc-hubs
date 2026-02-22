import { SfuAdapter } from "../../sfu-adapters/sfu-adapter";
import { AvatarSyncHelper } from "../avatar-sync-helper";

/**
 * Context provided to channel handlers for message processing.
 */
export interface ChannelHandlerContext {
  /** The SFU adapter that received the message */
  adapter: SfuAdapter;
  /** The local client ID */
  clientId: string;
  /** The room ID */
  roomId: string;
  /** Shared text decoder for efficiency */
  textDecoder: TextDecoder;
  /** Shared text encoder for efficiency */
  textEncoder: TextEncoder;
  /** Avatar sync helper for mandatory avatar channels */
  avatarSyncHelper: AvatarSyncHelper;
}

/**
 * Interface for data channel message handlers.
 * Each channel type has its own handler implementation.
 */
export interface IChannelHandler {
  /** Channel label this handler processes (e.g., "#nimpro", "#avatar-RIG") */
  readonly channelLabel: string;

  /** Whether this is a mandatory (avatar sync) or optional (feature) channel */
  readonly isMandatory: boolean;

  /** Priority for dispatch order (lower = higher priority, processed first) */
  readonly priority: number;

  /**
   * Handle an incoming message on this channel.
   * @param data The raw message data
   * @param context Handler context with adapter, clientId, etc.
   */
  handleMessage(data: Uint8Array, context: ChannelHandlerContext): void;

  /**
   * Optional: Called when the channel becomes ready (data channel opened).
   * @param context Handler context
   */
  onChannelReady?(context: ChannelHandlerContext): void;

  /**
   * Optional: Called when the adapter disconnects. Use for cleanup.
   * @param context Handler context
   */
  onDisconnect?(context: ChannelHandlerContext): void;
}

/**
 * Handler constructor type for factory registration.
 */
export type ChannelHandlerConstructor = new () => IChannelHandler;
