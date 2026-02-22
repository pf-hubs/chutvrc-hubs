import {
  Room,
  RoomEvent,
  Participant,
  RemoteParticipant,
  Track,
  RemoteTrack,
  TrackPublication,
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
import { MediaDevices } from "../utils/media-devices-utils";
import { AvatarSyncHelper } from "../utils/avatar-sync-helper";
import { CrossRoomStreamerAudioSource } from "../components/cross-room-streamer-audio-source";
import { SFU, SFU_CONNECTION_TYPE } from "../sfu-types";
import { SfuConnectionState } from "../types/sfu-adapter-interface";
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

type ConnectProps = {
  clientId: string;
  roomName: string;
  serverUrl: string;
  accessToken: string;
  scene: Element;
};

interface PendingMediaRequest {
  resolve: (stream: MediaStream) => void;
  reject: (error: Error) => void;
  promise?: Promise<MediaStream>;
}

export class LivekitAdapter extends SfuAdapter {
  // LiveKit Room instance
  private _room: Room | null = null;

  // Connection state management
  private _connectionState: SfuConnectionState = SfuConnectionState.DISCONNECTED;
  private _connectParams: ConnectProps | null = null;
  private _retryCount: number = 0;

  // Local media state
  private _localMediaStream: MediaStream | null = null;
  private _micPublication: LocalTrackPublication | null = null;
  private _cameraPublication: LocalTrackPublication | null = null;
  private _sharePublication: LocalTrackPublication | null = null;

  // Remote participants and streams
  private _remoteParticipants: Map<string, RemoteParticipant> = new Map();
  private _remoteMediaStreams: Map<string, MediaStream> = new Map();

  // State management
  private _pendingMediaRequests: Map<string, Record<string, PendingMediaRequest>> = new Map();
  private _blockedClients: Set<string> = new Set();
  private _micShouldBeEnabled: boolean = false;
  private _scene: Element | null = null;

  // Data channel ready state
  private _dataChannelReadyChannels: Set<string> = new Set();

  // Cross-room audio sources for public speakers
  crossRoomStreamerAudioSource: Record<string, CrossRoomStreamerAudioSource> = {};

  // Handler system - keep reference for cleanup
  private _laserPointerHandler: LaserPointerHandler | null = null;

  constructor(connectionType: SFU_CONNECTION_TYPE) {
    super();
    this._sfuId = SFU.LIVEKIT;
    this._connectionType = connectionType;
    this._clientId = "";
    this._avatarSyncHelper = new AvatarSyncHelper(this);
    this._dataChannelMessages = [];
    this._recordedDataChannelMessages = [];
    this._publicSpeakerClientIdsInRoom = [];

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

  protected _handleSfuTokenUpdated(event: CustomEvent): void {
    if (this._connectParams) this._connectParams.accessToken = event.detail.token;
  }

  async connect({ clientId, roomName, serverUrl, accessToken, scene }: ConnectProps): Promise<void> {
    this._scene = scene;
    this._roomId = roomName;
    this._clientId = clientId;
    this._connectParams = { clientId, roomName, serverUrl, accessToken, scene };
    this._connectionState = SfuConnectionState.CONNECTING;

    this.updateDispatcherContext();

    let tokenToUse = accessToken;
    if (!tokenToUse || tokenToUse === "") {
      debug("No access token provided, fetching fresh token...");
      const freshToken = await this._ensureFreshToken();
      if (freshToken) {
        tokenToUse = freshToken;
        if (this._connectParams) this._connectParams.accessToken = freshToken;
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
    if (!this._connectParams) {
      console.error("Cannot reconnect: no connection params saved");
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
    if (freshToken && this._connectParams) this._connectParams.accessToken = freshToken;

    const delay = Math.min(RETRY_CONFIG.baseDelay * Math.pow(2, this._retryCount - 1), RETRY_CONFIG.maxDelay);
    debug(`Reconnecting in ${delay}ms (attempt ${this._retryCount}/${RETRY_CONFIG.maxRetries})`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect(this._connectParams);
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
        this._updateRemoteMediaStream(participant, track);
        this._resolvePendingMediaRequestForTrack(participant.identity, track);
        this.emit("stream_updated", participant.identity, track.kind);
        this._tryAttachAudioToPublicSpeakerAgent(participant.identity, track);
      }
    );

    // Track unsubscribed
    this._room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
        debug("Track unsubscribed:", track.kind, "from", participant.identity);
        this._updateRemoteMediaStream(participant);
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

        const label = topic;
        const data = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);

        this._dataChannelMessages.push({ channelLabel: label, message: data as ArrayBuffer });

        if (this._isRecording && !label.includes("#avatar-")) {
          this._recordedDataChannelMessages.push({
            l: label,
            m: this._textDecoder.decode(data),
            t: Date.now(),
            s: 0
          });
        }

        // Limit queue size
        while (this._dataChannelMessages.length > 100) {
          this._dataChannelMessages.shift();
        }

        // Dispatch through handler system (base class method)
        this.handleDataChannelMessage(label, data as ArrayBuffer);
      }
    );
  }

  private _cleanupParticipant(clientId: string): void {
    // Remove from participants map
    this._remoteParticipants.delete(clientId);
    this._remoteMediaStreams.delete(clientId);

    // Clean up pending media requests
    const requests = this._pendingMediaRequests.get(clientId);
    if (requests) {
      Object.values(requests).forEach(req => {
        req.reject(new Error(`Participant ${clientId} disconnected`));
      });
      this._pendingMediaRequests.delete(clientId);
    }

    // Clean up cross-room audio source
    if (this.crossRoomStreamerAudioSource[clientId]) {
      this.crossRoomStreamerAudioSource[clientId].remove?.();
      delete this.crossRoomStreamerAudioSource[clientId];
    }

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

  private _updateRemoteMediaStream(participant: RemoteParticipant, newTrack?: RemoteTrack): void {
    let stream = this._remoteMediaStreams.get(participant.identity);

    if (!stream) {
      stream = new MediaStream();
      this._remoteMediaStreams.set(participant.identity, stream);
    }

    // Remove old tracks
    stream.getTracks().forEach(t => stream!.removeTrack(t));

    // Add current tracks
    participant.trackPublications.forEach(publication => {
      if (publication.track && publication.isSubscribed) {
        const mediaTrack = publication.track.mediaStreamTrack;
        if (mediaTrack) {
          stream!.addTrack(mediaTrack);
        }
      }
    });
  }

  private async _initializeLocalAudio(): Promise<void> {
    try {
      this._localMediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });

      const audioTrack = this._localMediaStream.getAudioTracks()[0];
      if (audioTrack) {
        // publishTrack returns LocalTrackPublication
        this._micPublication = await this._room!.localParticipant.publishTrack(audioTrack, {
          name: "microphone",
          simulcast: false
        });

        // Start muted by default
        this.enableMicrophone(false);
      }

      this._initializeDataChannels();
    } catch (error) {
      console.error("Failed to initialize local audio:", error);
      this.emitRTCEvent("error", "Media", () => `Microphone init failed: ${error}`);
      // Don't throw - continue without microphone
    }
  }

  private _initializeDataChannels(): void {
    const channelsToProduce = this._avatarSyncHelper._channelsForSync.concat([
      "#nimpro",
      "#iot",
      "#pdfPage",
      "#laserPointer",
      "#emoji",
      "#togglePublicSpeaker"
    ]);

    channelsToProduce.forEach(label => {
      this._dataChannelReadyChannels.add(label);
      if (!this._clientId.includes("PS-") || this._roomId.includes("public_speaking")) {
        this._avatarSyncHelper.handleSyncInit(label);
      }
    });
  }

  async disconnect(): Promise<void> {
    debug("disconnect()");
    this._connectionState = SfuConnectionState.DISCONNECTED;

    // Clean up all participants
    this._remoteParticipants.forEach((_, clientId) => {
      this._cleanupParticipant(clientId);
    });

    // Disconnect from room
    if (this._room) {
      await this._room.disconnect();
      this._room = null;
    }

    // Clean up intervals
    if (this._sendSelfAvatarSrcIntervalId) {
      clearInterval(this._sendSelfAvatarSrcIntervalId);
    }

    // Stop avatar sync
    this._avatarSyncHelper?.stopSyncing();

    // Cleanup message dispatcher
    this.cleanupDispatcher();

    // Cleanup token handler
    this._cleanupTokenHandler();

    // Clean up local media
    if (this._localMediaStream) {
      this._localMediaStream.getTracks().forEach(track => track.stop());
      this._localMediaStream = null;
    }

    this._micPublication = null;
    this._cameraPublication = null;
    this._sharePublication = null;
    this._laserPointerHandler = null;
    this._remoteParticipants.clear();
    this._remoteMediaStreams.clear();
    this._pendingMediaRequests.clear();
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

  getMediaStream(clientId: string, kind = "audio") {
    let stream: MediaStream | null | undefined = null;
    let tracks: MediaStreamTrack[] | null | undefined = null;

    const isSelfStreamRetrievable = this._clientId === clientId && this._connectionType !== SFU_CONNECTION_TYPE.RECV;
    const isOtherStreamRetrievable = this._clientId !== clientId && this._connectionType !== SFU_CONNECTION_TYPE.SEND;

    // Self stream
    if (isSelfStreamRetrievable) {
      const selfTracks: MediaStreamTrack[] = [];

      if (kind === "audio" && this._micPublication) {
        const mediaTrack = this._micPublication.track?.mediaStreamTrack;
        if (mediaTrack) selfTracks.push(mediaTrack);
      } else if (kind === "video") {
        if (this._cameraPublication) {
          const mediaTrack = this._cameraPublication.track?.mediaStreamTrack;
          if (mediaTrack) selfTracks.push(mediaTrack);
        } else if (this._sharePublication) {
          const mediaTrack = this._sharePublication.track?.mediaStreamTrack;
          if (mediaTrack) selfTracks.push(mediaTrack);
        }
      }

      if (selfTracks.length > 0) {
        tracks = selfTracks;
      }
    } else if (isOtherStreamRetrievable) {
      // Remote stream
      stream = this._remoteMediaStreams.get(clientId);
      if (stream) {
        tracks = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
      }
    }

    if (tracks && tracks.length > 0) {
      debug(`Already had ${kind} for ${clientId}`);
      const promise = Promise.resolve(new MediaStream(tracks));
      promise.catch(e => {
        this.emitRTCEvent("error", "Adapter", () => `getMediaStream error: ${e}`);
        console.warn(`${clientId} getMediaStream Error`, e);
      });
      return promise;
    } else if (isSelfStreamRetrievable || isOtherStreamRetrievable) {
      // Pending request
      debug(`Waiting on ${kind} for ${clientId}`);
      if (!this._pendingMediaRequests.has(clientId)) {
        this._pendingMediaRequests.set(clientId, {});
      }

      const requests = this._pendingMediaRequests.get(clientId)!;

      const promise = new Promise<MediaStream>((resolve, reject) => {
        requests[kind] = { resolve, reject };

        // Timeout after 30 seconds
        setTimeout(() => {
          if (requests[kind]) {
            reject(new Error(`Timeout waiting for ${kind} stream from ${clientId}`));
            delete requests[kind];
          }
        }, 30000);
      });

      requests[kind].promise = promise;

      return promise;
    }
  }

  getLocalMicTrack(): MediaStreamTrack | undefined {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return undefined;
    return this._micPublication?.track?.mediaStreamTrack;
  }

  getLocalMediaStream(): MediaStream | undefined {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return undefined;
    return this._localMediaStream ?? undefined;
  }

  getDataChannelMessage(): { channelLabel: string; message: ArrayBuffer | null } {
    return this._dataChannelMessages.length > 0
      ? this._dataChannelMessages.shift()!
      : { channelLabel: "", message: null };
  }

  async setLocalMediaStream(
    stream: MediaStream,
    videoContentHintByTrackId: Map<string, string> | null = null
  ): Promise<void> {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV || !this._room) return;

    let sawAudio = false;
    let sawVideo = false;

    await Promise.all(
      stream.getTracks().map(async track => {
        if (track.kind === "audio") {
          sawAudio = true;

          if (this._micPublication) {
            // Publish new track (will replace old one)
            await this._room!.localParticipant.publishTrack(track, {
              name: "microphone"
            });
          } else {
            this._micPublication = await this._room!.localParticipant.publishTrack(track, {
              name: "microphone"
            });
          }

          this.emit("mic-state-changed", { enabled: this.isMicEnabled });
        } else {
          sawVideo = true;
          const contentHint = videoContentHintByTrackId?.get(track.id);

          if (contentHint === MediaDevices.SCREEN) {
            await this.disableCamera();
            await this.enableShare(track);
          } else if (contentHint === MediaDevices.CAMERA) {
            await this.disableShare();
            await this.enableCamera(track);
          }
        }
      })
    );

    if (!sawVideo) {
      await this.disableCamera();
      await this.disableShare();
    }

    this._localMediaStream = stream;
  }

  setLocalDataChannelMessage({ channelLabel, message }: { channelLabel: string; message: ArrayBuffer }): void {
    if (!channelLabel || !message) return;
    this.broadcastUint8(channelLabel, new Uint8Array(message));
  }

  toggleMicrophone(): void {
    this.enableMicrophone(!this._micShouldBeEnabled);
  }

  enableMicrophone(enabled: boolean): void {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;

    if (this._room?.localParticipant) {
      this._room.localParticipant.setMicrophoneEnabled(enabled);
      this._micShouldBeEnabled = enabled;
      this.emit("mic-state-changed", { enabled: this._micShouldBeEnabled });
    }
  }

  get isMicEnabled(): boolean | null {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return false;
    return this._room?.localParticipant.isMicrophoneEnabled ?? false;
  }

  async enableCamera(track: MediaStreamTrack): Promise<void> {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV || !this._room) return;

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

  async disableCamera(): Promise<void> {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV || !this._room) return;

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

  async enableShare(track: MediaStreamTrack): Promise<void> {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV || !this._room) return;

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

  async disableShare(): Promise<void> {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV || !this._room) return;

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

  broadcast(channel: string, message: string): void {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV || !this._room) return;

    try {
      const data = this._textEncoder.encode(message);
      this._room.localParticipant.publishData(data, {
        reliable: true,
        topic: channel
      });

      if (this._isRecording && !channel.includes("#avatar-")) {
        this._recordedDataChannelMessages.push({
          l: channel,
          m: message,
          t: Date.now(),
          s: 1
        });
      }
    } catch (error) {
      console.error("Broadcast error:", error);
      this.emitRTCEvent("error", "DataChannel", () => `Broadcast failed: ${error}`);
    }
  }

  broadcastUint8(channel: string, message: Uint8Array): void {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV || !this._room) return;

    try {
      // Avatar transform data is time-sensitive, use unreliable
      const reliable = !channel.includes("#avatar-");

      this._room.localParticipant.publishData(message, {
        reliable,
        topic: channel
      });

      if (this._isRecording && !channel.includes("#avatar-")) {
        this._recordedDataChannelMessages.push({
          l: channel,
          m: this._textDecoder.decode(message),
          t: Date.now(),
          s: 1
        });
      }
    } catch (error) {
      console.error("BroadcastUint8 error:", error);
    }
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

  private _resolvePendingMediaRequestForTrack(clientId: string, track: RemoteTrack): void {
    if (this._connectionType === SFU_CONNECTION_TYPE.SEND) return;

    const requests = this._pendingMediaRequests.get(clientId);
    if (!requests) return;

    const kind = track.kind;
    if (requests[kind]) {
      const resolve = requests[kind].resolve;
      delete requests[kind];

      const mediaTrack = track.mediaStreamTrack;
      if (mediaTrack) {
        resolve(new MediaStream([mediaTrack]));
      }
    }

    if (Object.keys(requests).length === 0) {
      this._pendingMediaRequests.delete(clientId);
    }
  }

  private async _tryAttachAudioToPublicSpeakerAgent(clientId: string, track: RemoteTrack): Promise<void> {
    if (!clientId.includes("PS-") || this._roomId.includes("public_speaking")) return;
    if (track.kind !== "audio") return;

    try {
      const stream = await this.getMediaStream(clientId, "audio");
      if (!stream) return;

      this.crossRoomStreamerAudioSource[clientId] = new CrossRoomStreamerAudioSource(
        new MediaStream(stream as any)
      );

      const tryAttachAudioToAvatar = (): void => {
        const avatarEid = this._avatarSyncHelper._client2AvatarEid.get(clientId);
        if (avatarEid) {
          const avatarObj = (window as any).APP.world.eid2obj.get(avatarEid);
          if (avatarObj) {
            this.crossRoomStreamerAudioSource[clientId].attachAudio(avatarObj);
            return;
          }
        }
        // Retry if not attached yet
        if (this.crossRoomStreamerAudioSource[clientId] && !this.crossRoomStreamerAudioSource[clientId].node) {
          window.setTimeout(tryAttachAudioToAvatar, 1000);
        }
      };

      tryAttachAudioToAvatar();
    } catch (error) {
      console.error(`Error attaching audio to public speaker ${clientId}:`, error);
    }
  }
}
