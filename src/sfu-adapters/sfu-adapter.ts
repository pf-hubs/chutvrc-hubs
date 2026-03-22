import EventEmitter from "eventemitter3";
import { AvatarSyncHelper } from "../utils/avatar-sync-helper";
import { SFU, SFU_CONNECTION_TYPE } from "../sfu-types";
import {
  BridgeCapable,
  BridgeEnvelope,
  BridgeMessageCallback,
  IOT_BRIDGE_CHANNEL
} from "../libpeer/bridge/bridge-capable";
import { serializeBridgeEnvelope, deserializeBridgeEnvelope } from "../libpeer/bridge/bridge-message-protocol";
import {
  DataChannelMessage,
  ISfuConnectable,
  ISfuMediaStreams,
  ISfuMicrophoneControl,
  ISfuDataChannels,
  ISfuParticipantControl,
  ISfuDiagnostics,
  SfuConnectionState
} from "../types/sfu-adapter-interface";
import {
  DataChannelMessageDispatcher,
  ChannelHandlerRegistry,
  IChannelHandler
} from "../utils/data-channel-handlers";

// Re-export for backwards compatibility
export type { DataChannelMessage };
export { SfuConnectionState };

type Vector3 = { x: number; y: number; z: number };
type RecordedDataChannelAvatarTransform = { c: string; p: Vector3; r: Vector3 };
type RecordedDataChannelMessage = {
  l: string;
  m: string | RecordedDataChannelAvatarTransform | null;
  t: number;
  s: 0 | 1;
}; // l: label/chanel, m: message, t: timestamp, s: isSend (0: false (is recv), 1: true)

export const SFU_CONNECTION_CONNECTED = "sfu-connection-connected";
export const SFU_CONNECTION_ERROR_FATAL = "sfu-connection-error-fatal";

export abstract class SfuAdapter extends EventEmitter implements BridgeCapable {
  _sfuId: SFU;
  _clientId: string;
  _roomId: string;
  _avatarSyncHelper: AvatarSyncHelper;
  _connectionType: SFU_CONNECTION_TYPE;
  _dataChannelMessages: DataChannelMessage[];
  _recordedDataChannelMessages: RecordedDataChannelMessage[];
  _isRecording: boolean;
  _sendSelfAvatarSrcIntervalId: NodeJS.Timer;
  _publicSpeakerClientIdsInRoom: string[];

  // Message dispatcher for structured channel handling
  protected _messageDispatcher: DataChannelMessageDispatcher | null = null;
  protected _handlerRegistry: ChannelHandlerRegistry | null = null;

  // BridgeCapable implementation
  protected _bridgeMessageCallbacks: Set<BridgeMessageCallback> = new Set();
  protected _textEncoder: TextEncoder = new TextEncoder();
  protected _textDecoder: TextDecoder = new TextDecoder();

  // Token management
  protected _hubChannel: any = null;
  private _boundTokenHandler: ((event: CustomEvent) => void) | null = null;

  set hubChannel(channel: any) {
    if (this._hubChannel && this._boundTokenHandler) {
      this._hubChannel.removeEventListener("sfu_token_updated", this._boundTokenHandler);
    }
    this._hubChannel = channel;
    if (channel) {
      this._boundTokenHandler = this._handleSfuTokenUpdated.bind(this);
      channel.addEventListener("sfu_token_updated", this._boundTokenHandler);
    }
  }

  get hubChannel(): any {
    return this._hubChannel;
  }

  protected _handleSfuTokenUpdated(event: CustomEvent): void {}

  protected async _ensureFreshToken(): Promise<string | null> {
    if (!this._hubChannel) return null;
    try {
      return await this._hubChannel.getSfuTokenOrFetch();
    } catch (error) {
      return null;
    }
  }

  protected _cleanupTokenHandler(): void {
    if (this._hubChannel && this._boundTokenHandler) {
      this._hubChannel.removeEventListener("sfu_token_updated", this._boundTokenHandler);
      this._boundTokenHandler = null;
    }
  }

  connect(props: any) {}
  disconnect() {}
  getMediaStream(clientId: string, kind: string) {}
  getDataChannelMessage(): DataChannelMessage | undefined {
    return { channelLabel: "", message: null };
  }
  getLocalMicTrack(): MediaStreamTrack | undefined {
    return undefined;
  }
  getLocalMediaStream() {}
  setLocalMediaStream(stream: MediaStream, videoContentHintByTrackId?: Map<string, string> | null) {}
  setLocalDataChannelMessage(m: DataChannelMessage) {} // TODO: specify type
  toggleMicrophone() {}
  enableMicrophone(enabled: boolean) {}
  get isMicEnabled(): boolean | null {
    return false;
  }
  async enableCamera(track: MediaStreamTrack) {}
  async disableCamera() {}
  async enableShare(track: MediaStreamTrack) {}
  async disableShare() {}
  kick(clientId: string) {}
  block(clientId: string) {}
  unblock(clientId: string) {}
  broadcast(channel: string, message: string) {}
  broadcastUint8(channel: string, message: Uint8Array) {}
  emitRTCEvent(level: string, tag: string, msgFunc: () => void) {}

  // ========== Message Dispatcher ==========

  /**
   * Initialize the message dispatcher with a handler registry.
   * Call this in subclass constructors or connect methods.
   */
  protected initializeMessageDispatcher(registry: ChannelHandlerRegistry): void {
    this._handlerRegistry = registry;
    this._messageDispatcher = new DataChannelMessageDispatcher(this, this._avatarSyncHelper, registry);
  }

  /**
   * Handle an incoming data channel message through the dispatcher.
   * Subclasses should call this instead of handling messages inline.
   */
  protected handleDataChannelMessage(channelLabel: string, data: ArrayBuffer): void {
    if (this._messageDispatcher) {
      this._messageDispatcher.dispatchMessage(channelLabel, data);
    }
  }

  /**
   * Update dispatcher context after connection is established.
   */
  protected updateDispatcherContext(): void {
    if (this._messageDispatcher) {
      this._messageDispatcher.updateContext(this._clientId, this._roomId);
    }
  }

  /**
   * Register a channel handler.
   */
  protected registerHandler(handler: IChannelHandler): void {
    if (this._handlerRegistry) {
      this._handlerRegistry.register(handler);
    }
  }

  /**
   * Get the handler registry.
   */
  protected getHandlerRegistry(): ChannelHandlerRegistry | null {
    return this._handlerRegistry;
  }

  /**
   * Cleanup dispatcher on disconnect.
   */
  protected cleanupDispatcher(): void {
    if (this._messageDispatcher) {
      this._messageDispatcher.cleanup();
    }
  }

  // ========== BridgeCapable Implementation ==========

  /**
   * Check if this adapter supports IoT bridging
   */
  get isBridgeCapable(): boolean {
    return true;
  }

  /**
   * Check if bridge channel is ready for transmission
   * Must be overridden by concrete adapter implementations
   */
  get isBridgeChannelReady(): boolean {
    return false;
  }

  /**
   * Get the client ID
   */
  get clientId(): string {
    return this._clientId;
  }

  /**
   * Send a message through the bridge channel to room participants
   */
  sendBridgeMessage(envelope: BridgeEnvelope): boolean {
    if (!this.isBridgeChannelReady) {
      return false;
    }
    const serialized = serializeBridgeEnvelope(envelope);
    this.broadcast(IOT_BRIDGE_CHANNEL, serialized);
    return true;
  }

  /**
   * Register a callback for incoming bridge messages
   */
  onBridgeMessage(callback: BridgeMessageCallback): void {
    this._bridgeMessageCallbacks.add(callback);
  }

  /**
   * Remove a bridge message callback
   */
  offBridgeMessage(callback: BridgeMessageCallback): void {
    this._bridgeMessageCallbacks.delete(callback);
  }

  /**
   * Process incoming bridge channel message
   * Called by channel handlers when receiving data on #iot channel
   */
  processBridgeChannelMessage(data: ArrayBuffer): void {
    const text = this._textDecoder.decode(data);
    const envelope = deserializeBridgeEnvelope(text);
    if (envelope) {
      this._bridgeMessageCallbacks.forEach(cb => cb(envelope));
    }
  }
}
