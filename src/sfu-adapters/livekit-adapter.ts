import {
  Room,
  RoomEvent,
  Participant,
  RemoteParticipant,
  Track,
  RemoteTrack,
  TrackPublication,
  LocalAudioTrack,
  LocalTrackPublication,
  RemoteTrackPublication,
  ConnectionState,
  ParticipantEvent,
  RoomOptions,
  VideoPresets,
  DisconnectReason,
  DataPacket_Kind
} from "livekit-client";
import { debug as newDebug } from "debug";
import { SFU_CONNECTION_CONNECTED, SFU_CONNECTION_ERROR_FATAL, SfuAdapter } from "./sfu-adapter";
import { SFU, SFU_CONNECTION_TYPE } from "../sfu-types";
import { SfuConnectionState } from "../types/sfu-adapter-interface";
import { LivekitConfig, SfuConfig } from "./sfu-config";
import { ChannelSpec, dataChannelLabels } from "./data-channel-bus";
import { LocalTrackKind } from "./media-session";
import {
  ChannelHandlerRegistry,
  createAvatarSyncHandlers,
  NimproHandler,
  IotBridgeHandler,
  PdfPageHandler,
  TogglePublicSpeakerHandler,
  LaserPointerHandler,
  EmojiHandler
} from "../utils/data-channel-handlers";

const debug = newDebug("livekit-adapter:debug");

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000
};

// A request for a remote stream gives up after this long
const PENDING_MEDIA_TIMEOUT_MS = 30000;

export class LivekitAdapter extends SfuAdapter<LivekitConfig> {
  // LiveKit Room instance
  private _room: Room | null = null;

  // Connection state management
  private _connectionState: SfuConnectionState = SfuConnectionState.DISCONNECTED;
  private _retryCount: number = 0;

  // Local media state
  private _micPublication: LocalTrackPublication | null = null;
  private _cameraPublication: LocalTrackPublication | null = null;
  private _sharePublication: LocalTrackPublication | null = null;
  // The microphone stream the adapter acquired itself on connect; the only local stream it may stop
  private _ownAudioStream: MediaStream | null = null;

  // Remote participants
  private _remoteParticipants: Map<string, RemoteParticipant> = new Map();

  // State management
  private _blockedClients: Set<string> = new Set();
  private _scene: Element | null = null;

  // Data channel ready state
  private _dataChannelReadyChannels: Set<string> = new Set();

  // Handler system - keep reference for cleanup
  private _laserPointerHandler: LaserPointerHandler | null = null;

  constructor(connectionType: SFU_CONNECTION_TYPE) {
    super(SFU.LIVEKIT, connectionType, { pendingTimeoutMs: PENDING_MEDIA_TIMEOUT_MS });

    // Initialize message dispatcher with handlers for LivekitAdapter
    this.initializeLivekitHandlers();
  }

  /**
   * Initialize channel handlers for LivekitAdapter.
   * Follows the same pattern as DialogAdapter and SoraAdapter.
   */
  private initializeLivekitHandlers(): void {
    const registry = new ChannelHandlerRegistry();

    // Register avatar sync handlers (mandatory)
    createAvatarSyncHandlers().forEach(handler => registry.register(handler));

    // Register optional handlers
    registry.register(new NimproHandler());
    registry.register(new IotBridgeHandler());
    registry.register(new PdfPageHandler());
    registry.register(new TogglePublicSpeakerHandler());

    // Create and keep reference to laser pointer handler for cleanup
    this._laserPointerHandler = new LaserPointerHandler();
    registry.register(this._laserPointerHandler);

    registry.register(new EmojiHandler());

    this.initializeMessageDispatcher(registry);
  }

  get connectionState(): SfuConnectionState {
    return this._connectionState;
  }

  get isConnected(): boolean {
    return this._room !== null && this._room.state === ConnectionState.Connected;
  }

  protected _handleSfuTokenUpdated(event: CustomEvent): void {
    if (this._config) this._config = { ...this._config, accessToken: event.detail.token };
  }

  async connect(config: SfuConfig): Promise<void> {
    if (config.kind !== "livekit") {
      throw new Error(`LivekitAdapter cannot connect with a ${config.kind} config`);
    }
    const { clientId, roomName, serverUrl, accessToken, scene } = config;
    this._scene = scene;
    this._roomId = roomName;
    this._clientId = clientId;
    this._config = config;
    this._connectionState = SfuConnectionState.CONNECTING;

    this.updateDispatcherContext();

    let tokenToUse = accessToken;
    if (!tokenToUse || tokenToUse === "") {
      debug("No access token provided, fetching fresh token...");
      const freshToken = await this._ensureFreshToken();
      if (freshToken) {
        tokenToUse = freshToken;
        this._config = { ...config, accessToken: freshToken };
      } else {
        console.error("Failed to get LiveKit access token from server");
        this._connectionState = SfuConnectionState.FAILED;
        this.emit(SFU_CONNECTION_ERROR_FATAL);
        return;
      }
    }

    const roomOptions: RoomOptions = {
      adaptiveStream: true,
      dynacast: true,
      videoCaptureDefaults: {
        resolution: VideoPresets.h720.resolution
      },
      reconnectPolicy: {
        nextRetryDelayInMs: context => {
          const delay = Math.min(RETRY_CONFIG.baseDelay * Math.pow(2, context.retryCount), RETRY_CONFIG.maxDelay);
          return delay + Math.random() * 1000;
        }
      }
    };

    if (this._room) {
      // Drop the old room's listeners first so its own Disconnected event cannot start a second reconnect.
      // The published tracks are left running: the microphone belongs to the media devices manager
      this._room.removeAllListeners();
      try {
        await this._room.disconnect(false);
      } catch (error) {
        console.error("Failed to disconnect old LiveKit room:", error);
      }
    }

    this._room = new Room(roomOptions);
    this._setupRoomEventListeners();

    try {
      debug("Connecting to LiveKit:", serverUrl, "token present:", !!tokenToUse);
      await this._room.connect(serverUrl, tokenToUse, {
        autoSubscribe: this._connectionType !== SFU_CONNECTION_TYPE.SEND
      });

      this._connectionState = SfuConnectionState.CONNECTED;
      this._retryCount = 0;
      debug("Connected to LiveKit room:", roomName);
      this.emitRTCEvent("info", "Signaling", () => `Connected to room: ${roomName}`);

      // Initialize avatar sync with proper error handling
      try {
        this._avatarSyncHelper.initSelfAvatarTransform();
      } catch (error) {
        console.error("Failed to initialize avatar transform:", error);
        // Continue - avatar sync is non-critical for basic functionality
      }

      if (this._connectionType !== SFU_CONNECTION_TYPE.RECV && !this._clientId.includes("PS-")) {
        await this._initializeLocalAudio();
      }

      this.emit(SFU_CONNECTION_CONNECTED);
    } catch (error) {
      console.error("Failed to connect to LiveKit:", error);
      console.error("LiveKit connection details - serverUrl:", serverUrl, "token length:", tokenToUse?.length);
      this._connectionState = SfuConnectionState.FAILED;
      this.emitRTCEvent("error", "Signaling", () => `Connection failed: ${error}`);
      this.emit(SFU_CONNECTION_ERROR_FATAL);
    }
  }

  async reconnect(): Promise<void> {
    if (!this._config) {
      console.error("Cannot reconnect: no connection config saved");
      return;
    }

    if (this._retryCount >= RETRY_CONFIG.maxRetries) {
      console.error("Max reconnection attempts reached");
      this._connectionState = SfuConnectionState.FAILED;
      this.emit(SFU_CONNECTION_ERROR_FATAL);
      return;
    }

    this._connectionState = SfuConnectionState.RECONNECTING;
    this._retryCount++;

    const freshToken = await this._ensureFreshToken();
    if (freshToken) this._config = { ...this._config, accessToken: freshToken };

    const delay = Math.min(RETRY_CONFIG.baseDelay * Math.pow(2, this._retryCount - 1), RETRY_CONFIG.maxDelay);
    debug(`Reconnecting in ${delay}ms (attempt ${this._retryCount}/${RETRY_CONFIG.maxRetries})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect(this._config);
    } catch (error) {
      console.error("Reconnection failed:", error);
      this._connectionState = SfuConnectionState.FAILED;
      this.emit(SFU_CONNECTION_ERROR_FATAL);
    }
  }

  private _setupRoomEventListeners(): void {
    if (!this._room) return;

    // Connection state changes
    this._room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      debug("Connection state changed:", state);

      switch (state) {
        case ConnectionState.Connected:
          this._connectionState = SfuConnectionState.CONNECTED;
          break;
        case ConnectionState.Reconnecting:
          this._connectionState = SfuConnectionState.RECONNECTING;
          break;
        case ConnectionState.Disconnected:
          this._connectionState = SfuConnectionState.DISCONNECTED;
          this.reconnect();
          break;
      }
    });

    // Handle disconnection with reason
    this._room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      debug("Disconnected:", reason);

      if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
        // Don't reconnect if kicked due to duplicate identity
        this._connectionState = SfuConnectionState.FAILED;
        this.emit(SFU_CONNECTION_ERROR_FATAL);
      }
    });

    // Handle room reconnection
    this._room.on(RoomEvent.Reconnected, () => {
      debug("Reconnected to room");
      this._connectionState = SfuConnectionState.CONNECTED;
      this._retryCount = 0;
    });

    this._room.on(RoomEvent.Reconnecting, () => {
      debug("Reconnecting to room...");
      this._connectionState = SfuConnectionState.RECONNECTING;
    });

    // Participant connected
    this._room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      debug("Participant connected:", participant.identity);
      this._remoteParticipants.set(participant.identity, participant);

      if (this._connectionType !== SFU_CONNECTION_TYPE.RECV) {
        this._avatarSyncHelper.sendSelfAvatarTransform(false);
      }

      this._setupParticipantEventListeners(participant);
      this.emit("stream_updated", participant.identity, "audio");
      this.emit("stream_updated", participant.identity, "video");
    });

    // Participant disconnected
    this._room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
      debug("Participant disconnected:", participant.identity);
      this._cleanupParticipant(participant.identity);
    });

    // Track subscribed
    this._room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        if (this._blockedClients.has(participant.identity)) {
          debug("Ignoring track from blocked client:", participant.identity);
          return;
        }

        debug("Track subscribed:", track.kind, "from", participant.identity);
        this.media.addRemoteTrack(participant.identity, track.kind, track.mediaStreamTrack);
        this.emit("stream_updated", participant.identity, track.kind);
        if (track.kind === "audio") this.media.tryAttachAudioToPublicSpeakerAgent(participant.identity);
      }
    );

    // Track unsubscribed
    this._room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        debug("Track unsubscribed:", track.kind, "from", participant.identity);
        this.media.removeRemoteTrack(participant.identity, track.mediaStreamTrack);
      }
    );

    // Data received - NOTE: Using correct LiveKit v2 SDK signature
    this._room.on(
      RoomEvent.DataReceived,
      (
        payload: Uint8Array,
        participant?: Participant, // Can be undefined for server-sent data
        kind?: DataPacket_Kind,
        topic?: string
      ) => {
        if (!topic) return;
        if (participant && this._blockedClients.has(participant.identity)) return;

        this.bus.receive(topic, payload);
      }
    );
  }

  private _cleanupParticipant(clientId: string): void {
    // Remove from participants map
    this._remoteParticipants.delete(clientId);

    // Drop the streams and reject the pending media requests, then stop the cross-room audio source
    this.media.removePeer(clientId, new Error(`Participant ${clientId} disconnected`));
    this.media.removePublicSpeakerAudio(clientId);

    // Notify avatar sync helper (which should clean all its maps)
    this._avatarSyncHelper.handleOnClientLeave(clientId);

    // Hide laser pointer when public speaker disconnects
    if (clientId.includes("PS") && this._laserPointerHandler) {
      this._laserPointerHandler.hideLaserPointer();
    }
  }

  private _setupParticipantEventListeners(participant: RemoteParticipant): void {
    participant.on(ParticipantEvent.TrackMuted, (publication: TrackPublication) => {
      this.emit("stream_updated", participant.identity, publication.kind);
    });

    participant.on(ParticipantEvent.TrackUnmuted, (publication: TrackPublication) => {
      this.emit("stream_updated", participant.identity, publication.kind);
    });
  }

  private async _initializeLocalAudio(): Promise<void> {
    try {
      const localMediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      this._ownAudioStream = localMediaStream;
      this.media.rememberLocalStream(localMediaStream);

      const audioTrack = localMediaStream.getAudioTracks()[0];
      if (audioTrack) {
        // In the state last asked for: off at the first entry, as the user left it on a later connect
        await this.publishMicrophoneTrack(audioTrack);
        this.media.registerLocalTrack("microphone", audioTrack);
        this.emit("mic-state-changed", { enabled: this.isMicEnabled });
      }

      this._initializeDataChannels();
    } catch (error) {
      console.error("Failed to initialize local audio:", error);
      this.emitRTCEvent("error", "Media", () => `Microphone init failed: ${error}`);
      // Don't throw - continue without microphone
    }
  }

  private _initializeDataChannels(): void {
    dataChannelLabels().forEach(label => {
      this._dataChannelReadyChannels.add(label);
      if (!this._clientId.includes("PS-") || this._roomId.includes("public_speaking")) {
        this._avatarSyncHelper.handleSyncInit(label);
      }
    });
  }

  protected async closeConnection(): Promise<void> {
    debug("disconnect()");
    this._connectionState = SfuConnectionState.DISCONNECTED;

    // Disconnect from room. Detach the listeners first so that this intentional
    // disconnect does not trigger a reconnect from the Disconnected event. The SDK stops the
    // published tracks by default; they are unpublished only, since the tracks set from outside
    // belong to the media devices manager
    if (this._room) {
      this._room.removeAllListeners();
      await this._room.disconnect(false);
      this._room = null;
    }

    // The microphone the adapter acquired itself is stopped; a stream set from outside is left running
    if (this._ownAudioStream) {
      this._ownAudioStream.getTracks().forEach(track => track.stop());
      if (this.media.localStream === this._ownAudioStream) this.media.clearLocal();
      this._ownAudioStream = null;
    }

    this._micPublication = null;
    this._cameraPublication = null;
    this._sharePublication = null;
    this._remoteParticipants.clear();
    this._dataChannelReadyChannels.clear();

    this.emitRTCEvent("info", "Signaling", () => `[close]`);
  }

  // BridgeCapable implementation
  get isBridgeChannelReady(): boolean {
    return (
      this._room !== null &&
      this._room.state === ConnectionState.Connected &&
      this._connectionType !== SFU_CONNECTION_TYPE.RECV
    );
  }

  protected beforeLocalStreamApplied(): boolean {
    return this._room !== null;
  }

  protected async publishTrack(kind: LocalTrackKind, track: MediaStreamTrack): Promise<void> {
    switch (kind) {
      case "microphone":
        await this.publishMicrophone(track);
        break;
      case "camera":
        await this.publishCamera(track);
        break;
      case "screen":
        await this.publishShare(track);
        break;
    }
  }

  protected async replaceTrack(kind: LocalTrackKind, track: MediaStreamTrack): Promise<void> {
    if (kind === "microphone") {
      await this.publishMicrophone(track);
      return;
    }
    await this.unpublishTrack(kind);
    await this.publishTrack(kind, track);
  }

  protected async unpublishTrack(kind: LocalTrackKind): Promise<void> {
    switch (kind) {
      case "microphone":
        // The microphone stays published when a stream without an audio track is set, as before
        break;
      case "camera":
        await this.unpublishCamera();
        break;
      case "screen":
        await this.unpublishShare();
        break;
    }
  }

  protected async setMicEnabled(enabled: boolean): Promise<boolean> {
    // The mic track is published manually via publishTrack() (so we can wrap the
    // stream for eval chirp injection and control getUserMedia ourselves), which
    // gives it Source.Unknown. localParticipant.setMicrophoneEnabled() only acts
    // on a Source.Microphone track, so it silently no-ops here and the mic never
    // actually mutes — a LiveKit-only bug (Dialog pauses its producer directly).
    // Mute/unmute the real published track instead. Without a publication the
    // media session keeps the request and the microphone is published in it;
    // LiveKit's managed microphone would be a second one that the mute does not reach.
    const track = this._micPublication?.track;
    if (!track) return false;
    // The SDK mutes and unmutes behind a lock, so the state changes only once this settles
    if (enabled) {
      await track.unmute();
    } else {
      await track.mute();
    }
    return true;
  }

  protected micEnabled(): boolean | null {
    // Reflect the real published-track mute state — setMicrophoneEnabled() does
    // not own our manually-published track (see setMicEnabled).
    const track = this._micPublication?.track;
    return track ? !track.isMuted : null;
  }

  private async publishMicrophone(track: MediaStreamTrack): Promise<void> {
    const micTrack = this._micPublication?.track;
    if (micTrack instanceof LocalAudioTrack) {
      // Swap the MediaStreamTrack under the existing publication instead of publishing a second mic.
      // replaceTrack() keeps the publication's muted flag but not the new track's enabled flag,
      // so align them first or a muted mic would start sending audio.
      track.enabled = !micTrack.isMuted;
      await micTrack.replaceTrack(track);
    } else {
      await this.publishMicrophoneTrack(track);
    }

    this.emit("mic-state-changed", { enabled: this.isMicEnabled });
  }

  /**
   * Publishes a microphone track in the state last asked for. A microphone asked to be off is muted before it
   * is published, so it never sends; LiveKit would otherwise enable the track as it publishes it.
   */
  private async publishMicrophoneTrack(track: MediaStreamTrack): Promise<void> {
    const microphone = new LocalAudioTrack(track, undefined, true);
    if (!this.media.micShouldBeEnabled) await microphone.mute();
    this._micPublication = await this._room!.localParticipant.publishTrack(microphone, {
      name: "microphone",
      simulcast: false
    });
    // The request may have changed while the microphone was being published
    await this.setMicEnabled(this.media.micShouldBeEnabled);
  }

  private async publishCamera(track: MediaStreamTrack): Promise<void> {
    if (!this._room) return;

    try {
      // publishTrack returns LocalTrackPublication
      this._cameraPublication = await this._room.localParticipant.publishTrack(track, {
        name: "camera",
        simulcast: true,
        source: Track.Source.Camera
      });
    } catch (error) {
      console.error("Failed to enable camera:", error);
      this.emitRTCEvent("error", "Media", () => `Camera enable failed: ${error}`);
    }
  }

  private async unpublishCamera(): Promise<void> {
    if (!this._room) return;

    if (this._cameraPublication?.track) {
      try {
        // unpublishTrack takes LocalTrack, not MediaStreamTrack
        await this._room.localParticipant.unpublishTrack(this._cameraPublication.track);
      } catch (error) {
        console.error("Failed to disable camera:", error);
      }
      this._cameraPublication = null;
    }
  }

  private async publishShare(track: MediaStreamTrack): Promise<void> {
    if (!this._room) return;

    try {
      // publishTrack returns LocalTrackPublication
      this._sharePublication = await this._room.localParticipant.publishTrack(track, {
        name: "screen",
        simulcast: true,
        source: Track.Source.ScreenShare
      });
    } catch (error) {
      console.error("Failed to enable screen share:", error);
      this.emitRTCEvent("error", "Media", () => `Screen share enable failed: ${error}`);
    }
  }

  private async unpublishShare(): Promise<void> {
    if (!this._room) return;

    if (this._sharePublication?.track) {
      try {
        // unpublishTrack takes LocalTrack, not MediaStreamTrack
        await this._room.localParticipant.unpublishTrack(this._sharePublication.track);
      } catch (error) {
        console.error("Failed to disable screen share:", error);
      }
      this._sharePublication = null;
    }
  }

  kick(clientId: string): void {
    document.body.dispatchEvent(new CustomEvent("kicked", { detail: { clientId } }));
  }

  block(clientId: string): void {
    const participant = this._remoteParticipants.get(clientId);
    if (participant) {
      participant.trackPublications.forEach(publication => {
        if (publication.track) {
          publication.track.stop();
        }
      });
    }
    this._blockedClients.add(clientId);
    document.body.dispatchEvent(new CustomEvent("blocked", { detail: { clientId } }));
  }

  unblock(clientId: string): void {
    this._blockedClients.delete(clientId);
    document.body.dispatchEvent(new CustomEvent("unblocked", { detail: { clientId } }));
  }

  protected sendData(label: string, data: Uint8Array, spec: ChannelSpec): void {
    if (!this._room) return;
    this._room.localParticipant.publishData(data, {
      reliable: spec.reliable,
      topic: label
    });
  }

  emitRTCEvent(level: string, tag: string, msgFunc: () => void): void {
    if (!(window as any).APP?.store?.state?.preferences?.showRtcDebugPanel) return;
    const time = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "numeric",
      minute: "numeric",
      second: "numeric"
    });
    (this._scene as any)?.emit("rtc_event", { level, tag, time, msg: msgFunc() });
  }
}
