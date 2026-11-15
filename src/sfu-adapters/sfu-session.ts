import EventEmitter from "eventemitter3";
import { SFU, SFU_CONNECTION_TYPE } from "../sfu-types";
import { BridgeEnvelope, BridgeMessageCallback } from "../libpeer/bridge/bridge-capable";
import { ISfuAdapter } from "../types/sfu-adapter-interface";
import { AvatarSyncHelper } from "../utils/avatar-sync-helper";
import { BRIDGE_MESSAGE_RECEIVED, SfuAdapter } from "./sfu-adapter";
import { SfuAdapterFactory } from "./adapter-factory";
import { SfuConfig } from "./sfu-config";
import { DataChannelBus, RecordedDataChannelMessage } from "./data-channel-bus";
import { MediaSession } from "./media-session";

/** What a replaced adapter hands to its successor: the local media it published and the recording it was making. */
interface CarriedState {
  stream: MediaStream | null;
  videoContentHints: Map<string, string> | null;
  micEnabled: boolean;
  recorded: RecordedDataChannelMessage[];
  recording: boolean;
}

/**
 * The client's connection to the media server of the current room, for one role: the room's send-and-receive
 * connection (APP.sfu), the public speaker's sender, the listeners' mirror, or a speaker's agent.
 *
 * The session object lives as long as the role does. It holds one adapter for the media server it is
 * connected to, creates the adapter on the first connect() and replaces it when the room uses another kind
 * of server. Every event the adapter emits is emitted on the session as well, so subscribers register on the
 * session once and never need to know which adapter is behind it.
 */
export class SfuSession extends EventEmitter implements ISfuAdapter {
  readonly connectionType: SFU_CONNECTION_TYPE;

  private _adapter: SfuAdapter | null = null;
  private _hubChannel: any = null;
  private _disconnecting: Promise<void> | null = null;
  // Requests made before the first adapter exists; they are handed to it as soon as it is created
  private _requestsBeforeAdapter: Array<(adapter: SfuAdapter) => void> = [];

  constructor(connectionType: SFU_CONNECTION_TYPE) {
    super();
    this.connectionType = connectionType;
  }

  /** The adapter behind the session, or null before the first connect(). */
  get adapter(): SfuAdapter | null {
    return this._adapter;
  }

  // ========== Connection ==========

  /**
   * Joins the room described by the config. When the config is for another kind of media server than the
   * current adapter, the adapter is disconnected and replaced first; the local stream, the microphone state
   * and the recording of the replaced adapter are carried over to the new one. After every connect, also when
   * the adapter is kept, the local stream is published in the room and the microphone request applied. A
   * disconnect() still in flight is awaited, so a caller may call disconnect() and connect() back to back
   * without awaiting either.
   */
  async connect(config: SfuConfig): Promise<void> {
    if (this._disconnecting) await this._disconnecting.catch(() => {});

    let carried: CarriedState | null = null;
    if (this._adapter && this._adapter.sfuId !== SfuAdapterFactory.sfuTypeOf(config.kind)) {
      const previous = this._adapter;
      await this.disconnect().catch(error => console.error("Failed to disconnect the previous adapter:", error));
      // disconnect() unpublishes the local tracks but keeps the stream and the microphone wish
      carried = {
        stream: previous.media.localStream,
        videoContentHints: previous.media.localVideoContentHints,
        micEnabled: previous.media.micShouldBeEnabled,
        recorded: previous.bus.takeRecording(),
        recording: previous.bus.isRecording
      };
      previous.delegate = null;
      this._adapter = null;
    }

    if (!this._adapter) {
      const created = SfuAdapterFactory.create(config.kind, this.connectionType);
      created.delegate = this;
      // A replacement joins a room that already knows this client, so it has to announce the avatar again
      created.avatarSync.announceSelfOnSyncInit = carried !== null;
      if (carried) {
        created.bus.continueRecording(carried.recorded, carried.recording);
        // The microphone is published in the state the user last chose
        created.media.continueMicrophoneRequest(carried.micEnabled);
      }
      this._adapter = created;
      const requests = this._requestsBeforeAdapter;
      this._requestsBeforeAdapter = [];
      requests.forEach(request => request(created));
    }

    const adapter = this._adapter;
    const media = adapter.media;
    // The stream to publish in the room: the replaced adapter's, or the one this adapter published before. It is
    // taken before the connect, since LiveKit puts a microphone of its own in its place as it connects
    const stream = carried ? carried.stream : media.localStream;
    const videoContentHints = carried ? carried.videoContentHints : media.localVideoContentHints;

    if (this._hubChannel) adapter.hubChannel = this._hubChannel;
    await adapter.connect(config);

    // Dialog publishes the stream it kept as it joins, so the stream is applied only when the adapter has left
    // another stream, or no microphone, in its place. A microphone already published is swapped, not published again
    if (stream && adapter.isConnected) {
      const published = media.localStream === stream && media.localTrack("microphone") === stream.getAudioTracks()[0];
      if (!published) await adapter.setLocalMediaStream(stream, videoContentHints);
    }
    // The adapter keeps the request across a connect and publishes in it; this applies it and reports the state
    media.applyMicrophone();
  }

  /** Leaves the room; see SfuAdapter.disconnect() for what is closed and forgotten. The adapter is kept. */
  disconnect(): Promise<void> {
    if (!this._adapter) return Promise.resolve();
    const disconnecting = this._adapter.disconnect().finally(() => {
      if (this._disconnecting === disconnecting) this._disconnecting = null;
    });
    this._disconnecting = disconnecting;
    return disconnecting;
  }

  set hubChannel(channel: any) {
    this._hubChannel = channel;
    if (this._adapter) this._adapter.hubChannel = channel;
  }

  get hubChannel(): any {
    return this._hubChannel;
  }

  // ========== State ==========

  get sfuId(): SFU | null {
    return this._adapter ? this._adapter.sfuId : null;
  }

  get config(): SfuConfig | null {
    return this._adapter ? this._adapter.config : null;
  }

  get clientId(): string {
    return this._adapter ? this._adapter.clientId : "";
  }

  get roomId(): string {
    return this._adapter ? this._adapter.roomId : "";
  }

  get isConnected(): boolean {
    return this._adapter ? this._adapter.isConnected : false;
  }

  get bus(): DataChannelBus | null {
    return this._adapter ? this._adapter.bus : null;
  }

  get media(): MediaSession | null {
    return this._adapter ? this._adapter.media : null;
  }

  get avatarSync(): AvatarSyncHelper | null {
    return this._adapter ? this._adapter.avatarSync : null;
  }

  /** The clients speaking publicly in this room. Callers add and remove entries in place. */
  get publicSpeakerClientIds(): string[] {
    return this._adapter ? this._adapter.publicSpeakerClientIds : [];
  }

  get localMediaStream(): MediaStream | null {
    return this._adapter ? this._adapter.localMediaStream : null;
  }

  // ========== Media ==========

  /**
   * The stream for a client. Before the first connect() the request waits for the adapter, as it waits for a
   * track after it. Typed loosely for the callers, which are JavaScript and handle a null stream themselves.
   */
  getMediaStream(clientId: string, kind: string = "audio"): Promise<any> {
    if (this._adapter) return this._adapter.getMediaStream(clientId, kind);
    return new Promise<MediaStream | null>((resolve, reject) => {
      this._requestsBeforeAdapter.push(adapter => adapter.getMediaStream(clientId, kind).then(resolve, reject));
    });
  }

  getLocalMicTrack(): MediaStreamTrack | undefined {
    return this._adapter?.getLocalMicTrack();
  }

  getLocalMediaStream(): MediaStream | null | undefined {
    return this._adapter?.getLocalMediaStream();
  }

  async setLocalMediaStream(stream: MediaStream, videoContentHintByTrackId: Map<string, string> | null = null) {
    if (this._adapter) await this._adapter.setLocalMediaStream(stream, videoContentHintByTrackId);
  }

  enableMicrophone(enabled: boolean): void {
    this._adapter?.enableMicrophone(enabled);
  }

  toggleMicrophone(): void {
    this._adapter?.toggleMicrophone();
  }

  get isMicEnabled(): boolean | null {
    return this._adapter ? this._adapter.isMicEnabled : false;
  }

  // ========== Participants and data ==========

  kick(clientId: string): Promise<void> | void {
    return this._adapter?.kick(clientId);
  }

  block(clientId: string): Promise<void> | void {
    return this._adapter?.block(clientId);
  }

  unblock(clientId: string): Promise<void> | void {
    return this._adapter?.unblock(clientId);
  }

  broadcast(channel: string, message: string): void {
    this._adapter?.broadcast(channel, message);
  }

  broadcastUint8(channel: string, message: Uint8Array): void {
    this._adapter?.broadcastUint8(channel, message);
  }

  // ========== BridgeCapable ==========

  get isBridgeCapable(): boolean {
    return true;
  }

  get isBridgeChannelReady(): boolean {
    return this._adapter ? this._adapter.isBridgeChannelReady : false;
  }

  sendBridgeMessage(envelope: BridgeEnvelope): boolean {
    return this._adapter ? this._adapter.sendBridgeMessage(envelope) : false;
  }

  /** Bridge messages reach the session from whichever adapter receives them, so callbacks survive an adapter change. */
  onBridgeMessage(callback: BridgeMessageCallback): void {
    this.on(BRIDGE_MESSAGE_RECEIVED, callback);
  }

  offBridgeMessage(callback: BridgeMessageCallback): void {
    this.off(BRIDGE_MESSAGE_RECEIVED, callback);
  }
}
