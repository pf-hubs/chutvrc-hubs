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
import { SfuConfig } from "./sfu-config";
import { ChannelSpec, DataChannelBus } from "./data-channel-bus";
import { LocalTrackKind, MediaSession, MediaSessionOptions } from "./media-session";

// Re-export for backwards compatibility
export type { DataChannelMessage };
export { SfuConnectionState };

export const SFU_CONNECTION_CONNECTED = "sfu-connection-connected";
export const SFU_CONNECTION_ERROR_FATAL = "sfu-connection-error-fatal";

export abstract class SfuAdapter<TConfig extends SfuConfig = SfuConfig> extends EventEmitter implements BridgeCapable {
  _sfuId: SFU;
  _clientId: string;
  _roomId: string;
  _avatarSyncHelper: AvatarSyncHelper;
  _connectionType: SFU_CONNECTION_TYPE;
  _sendSelfAvatarSrcIntervalId: NodeJS.Timer;
  _publicSpeakerClientIdsInRoom: string[];

  // Data channel sending, recording and relaying, shared by every adapter
  readonly bus: DataChannelBus = new DataChannelBus(this, {
    send: (label, data, spec) => this.sendData(label, data, spec),
    dispatch: (label, data) => this.handleDataChannelMessage(label, data)
  });

  // Remote streams, local tracks, microphone state and public speaker audio, shared by every adapter
  readonly media: MediaSession;

  // The config of the current (or last) connection, set by connect()
  protected _config: TConfig | null = null;

  // Message dispatcher for structured channel handling
  protected _messageDispatcher: DataChannelMessageDispatcher | null = null;
  protected _handlerRegistry: ChannelHandlerRegistry | null = null;

  // BridgeCapable implementation
  protected _bridgeMessageCallbacks: Set<BridgeMessageCallback> = new Set();
  protected _textDecoder: TextDecoder = new TextDecoder();

  // Token management
  protected _hubChannel: any = null;
  private _boundTokenHandler: ((event: CustomEvent) => void) | null = null;

  constructor(mediaOptions: MediaSessionOptions = {}) {
    super();
    this.media = new MediaSession(
      this,
      {
        publishTrack: (kind, track) => this.publishTrack(kind, track),
        replaceTrack: (kind, track) => this.replaceTrack(kind, track),
        unpublishTrack: kind => this.unpublishTrack(kind),
        setMicEnabled: enabled => this.setMicEnabled(enabled),
        micEnabled: () => this.micEnabled(),
        localTracks: kind => this.localTracks(kind),
        beforeLocalStreamApplied: stream => this.beforeLocalStreamApplied(stream),
        afterLocalStreamApplied: stream => this.afterLocalStreamApplied(stream)
      },
      mediaOptions
    );
  }

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

  get config(): TConfig | null {
    return this._config;
  }

  /**
   * Whether the adapter has a live connection that can carry media and data.
   * Each adapter overrides this with its own readiness condition.
   */
  get isConnected(): boolean {
    return false;
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

  async connect(config: SfuConfig): Promise<void> {}
  disconnect() {}
  // Typed loosely for the callers, which are JavaScript and handle a null stream themselves
  getMediaStream(clientId: string, kind: string = "audio"): Promise<any> {
    return this.media.getMediaStream(clientId, kind);
  }
  getLocalMicTrack(): MediaStreamTrack | undefined {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return undefined;
    return this.media.localTrack("microphone");
  }
  getLocalMediaStream(): MediaStream | null | undefined {
    return this.media.localStream;
  }
  get _localMediaStream(): MediaStream | null {
    return this.media.localStream;
  }
  setLocalMediaStream(stream: MediaStream, videoContentHintByTrackId: Map<string, string> | null = null) {
    return this.media.setLocalMediaStream(stream, videoContentHintByTrackId);
  }
  toggleMicrophone(): void {
    this.media.toggleMicrophone();
  }
  enableMicrophone(enabled: boolean): void {
    this.media.enableMicrophone(enabled);
  }
  get isMicEnabled(): boolean | null {
    return this.media.isMicEnabled;
  }
  kick(clientId: string) {}
  block(clientId: string) {}
  unblock(clientId: string) {}
  broadcast(channel: string, message: string): void {
    this.bus.send(channel, message);
  }
  broadcastUint8(channel: string, message: Uint8Array): void {
    this.bus.send(channel, message);
  }
  emitRTCEvent(level: string, tag: string, msgFunc: () => void) {}

  // ========== Media Driver ==========

  /** Publishes a local track of a kind that was not published before. */
  protected abstract publishTrack(kind: LocalTrackKind, track: MediaStreamTrack): Promise<void>;

  /** Swaps the track under the existing publication of a kind. */
  protected abstract replaceTrack(kind: LocalTrackKind, track: MediaStreamTrack): Promise<void>;

  /** Removes the publication of a kind, if any. */
  protected abstract unpublishTrack(kind: LocalTrackKind): Promise<void>;

  /** Applies the microphone state in the SDK. Returns false when there was nothing to apply it to. */
  protected abstract setMicEnabled(enabled: boolean): boolean;

  /** The microphone state as the SDK sees it. */
  protected abstract micEnabled(): boolean | null;

  /** The local tracks of a media kind for getMediaStream of the own client. By default the published ones. */
  protected localTracks(kind: string): MediaStreamTrack[] {
    return this.media.publishedTracks(kind);
  }

  /** Runs before a new local stream is applied. Returns false to leave the stream unapplied. */
  protected beforeLocalStreamApplied(stream: MediaStream): boolean {
    return true;
  }

  /** Runs after a new local stream has been applied and remembered. */
  protected async afterLocalStreamApplied(stream: MediaStream): Promise<void> {}

  // ========== Data Channel Driver ==========

  /**
   * Hands the bytes for one channel to the SFU SDK. The bus calls this after it has
   * dropped sends on a receive-only adapter, encoded strings and recorded the message.
   */
  protected abstract sendData(label: string, data: Uint8Array, spec: ChannelSpec): void;

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
   * The bus calls this after it has recorded and queued the message.
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
