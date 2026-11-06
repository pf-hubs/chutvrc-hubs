import Sora, * as SoraType from "sora-js-sdk";
import { debug as newDebug } from "debug";
import { SFU_CONNECTION_CONNECTED, SFU_CONNECTION_ERROR_FATAL, SfuAdapter } from "./sfu-adapter";
import { MediaDevices } from "../utils/media-devices-utils";
import { SFU, SFU_CONNECTION_TYPE } from "../sfu-types";
import { SfuConfig, SoraConfig } from "./sfu-config";
import { soraDataChannels } from "./data-channel-bus";
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

const debug = newDebug("naf-dialog-adapter:debug");

export class SoraAdapter extends SfuAdapter<SoraConfig> {
  _connector: SoraType.ConnectionPublisher | SoraType.ConnectionSubscriber | null;
  _remoteMediaStreams: Map<string, MediaStream | null>;
  _clientStreamIdPair: Map<string, string>;
  _blockedClients: Map<string, boolean>;
  _scene: Element | null;
  _accessToken?: string;
  // Laser pointer handler instance for cleanup on client leave
  private _laserPointerHandler: LaserPointerHandler | null = null;

  constructor(sfuType = SFU_CONNECTION_TYPE.SENDRECV) {
    super(SFU.SORA, sfuType);
    this._connector = null;
    this._remoteMediaStreams = new Map<string, MediaStream | null>();
    this._clientStreamIdPair = new Map<string, string>();
    this._blockedClients = new Map<string, boolean>();

    // Initialize message dispatcher with handlers for SoraAdapter
    this.initializeSoraHandlers();
  }

  /**
   * Initialize channel handlers for SoraAdapter.
   * SoraAdapter supports all channels including presentation features.
   */
  private initializeSoraHandlers(): void {
    const registry = new ChannelHandlerRegistry();

    // Register avatar sync handlers (mandatory)
    createAvatarSyncHandlers().forEach(handler => registry.register(handler));

    // Register optional handlers for SoraAdapter
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

  protected _handleSfuTokenUpdated(event: CustomEvent): void {
    this._accessToken = event.detail.token;
  }

  async connect(config: SfuConfig): Promise<void> {
    if (config.kind !== "sora") {
      throw new Error(`SoraAdapter cannot connect with a ${config.kind} config`);
    }
    const { clientId, channelId, signalingUrls, accessToken, scene, debug } = config;
    this._config = config;
    this._scene = scene;
    this._roomId = channelId;
    this._clientId = clientId;

    let tokenToUse = accessToken;
    if (!tokenToUse || tokenToUse === "") {
      const freshToken = await this._ensureFreshToken();
      if (freshToken) tokenToUse = freshToken;
    }
    this._accessToken = tokenToUse;

    this.updateDispatcherContext();

    const sora = Sora.connection(signalingUrls, debug);
    const metadata = { access_token: tokenToUse };
    const options = {
      clientId: clientId,
      multistream: true,
      spotlight: true,
      audio: true,
      video: true,
      simulcast: true,
      audioCodecType: "OPUS" as SoraType.AudioCodecType,
      videoCodecType: "H264" as SoraType.VideoCodecType,
      dataChannelSignaling: true,
      dataChannels: soraDataChannels(this._connectionType)
    };

    this._connector =
      this._connectionType === SFU_CONNECTION_TYPE.RECV
        ? sora.recvonly(channelId, metadata, options)
        : this._connectionType === SFU_CONNECTION_TYPE.SEND
        ? sora.sendonly(channelId, metadata, options)
        : sora.sendrecv(channelId, metadata, options);

    this._connector.on("notify", event => {
      if (event.event_type === "connection.created") {
        event.data?.forEach(c => {
          // clients entering this room earlier
          if (
            this._connectionType !== SFU_CONNECTION_TYPE.SEND &&
            c.client_id &&
            c.connection_id &&
            !this._clientStreamIdPair.has(c.client_id)
          ) {
            this._clientStreamIdPair.set(c.client_id, c.connection_id);
            this.keepRemoteStream(c.client_id);
            this.media.tryAttachAudioToPublicSpeakerAgent(c.client_id);
            if (this._roomId.includes("public_speaking")) {
              this.emit("stream_updated", c.client_id, "audio");
              this.emit("stream_updated", c.client_id, "video");
            }
          }
        });

        // clients entering this room later
        if (
          this._connectionType !== SFU_CONNECTION_TYPE.SEND &&
          event.client_id &&
          event.client_id !== this._clientId &&
          event.connection_id &&
          !this._clientStreamIdPair.has(event.client_id)
        ) {
          this._clientStreamIdPair.set(event.client_id, event.connection_id);
          this.keepRemoteStream(event.client_id);
          // this._poseSync.sendSelfAvatarTransform(false);
          this.media.tryAttachAudioToPublicSpeakerAgent(event.client_id);
          this.emit("stream_updated", event.client_id, "audio");
          this.emit("stream_updated", event.client_id, "video");
        }

        if (this._connectionType !== SFU_CONNECTION_TYPE.RECV) this._poseSync.sendSelfAvatarTransform(false);
      }

      if (this._connectionType !== SFU_CONNECTION_TYPE.SEND) {
        if (event.event_type === "connection.updated") {
          this.emit("stream_updated", event.client_id, "audio");
          this.emit("stream_updated", event.client_id, "video");
        }
        if (event.event_type === "connection.destroyed" && event.client_id) {
          this._poseSync.handleOnClientLeave(event.client_id);
          console.log("Connection destroyed: " + event.client_id);
        }
      }
    });

    if (this._connectionType !== SFU_CONNECTION_TYPE.SEND) {
      this._connector.on("track", event => {
        const stream = event.streams[0];
        if (!stream) return;
        // if (!this._remoteMediaStreams.has(stream.id)) {
        this._remoteMediaStreams.set(stream.id, stream);
        // }
        for (const [clientId, streamId] of this._clientStreamIdPair.entries()) {
          if (streamId === stream.id) this.media.setRemoteStream(clientId, stream);
        }
      });
      this._connector.on("removetrack", event => {
        console.log("Track removed: " + event.track.id);
        const stream = event.target;
        if (!stream) return;
        for (let [clientId, streamId] of this._clientStreamIdPair.entries()) {
          // @ts-ignore
          if (streamId === event.target?.id) {
            this._clientStreamIdPair.delete(clientId);
            this.media.removePeer(clientId);
            // Hide laser pointer when public speaker disconnects
            if (clientId.includes("PS") && this._laserPointerHandler) {
              this._laserPointerHandler.hideLaserPointer();
            }
          }
        }
      });
      this._connector.on("message", event => {
        this.bus.receive(event.label, new Uint8Array(event.data));
      });
    }

    if (this._connectionType !== SFU_CONNECTION_TYPE.RECV) {
      this._connector.on("datachannel", event => {
        if (!this._clientId.includes("PS-") || this._roomId.includes("public_speaking")) {
          this._poseSync.handleSyncInit(event.datachannel.label);
        }
      });
      this._scene?.addEventListener("audio_ready", async () => {
        await new Promise(res => setTimeout(res, 1000));
        this._poseSync.sendSelfAvatarTransform(false);
      });
    }

    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) {
      // @ts-ignore
      this._connector.connect();
    } else {
      if (!this._clientId.includes("PS-"))
        this.media.rememberLocalStream(await navigator.mediaDevices.getUserMedia({ audio: true, video: false }));

      const connectSfuWithLocalMediaStream = () => {
        const localMediaStream = this.media.localStream;
        if (!this._connector || !localMediaStream) {
          window.setTimeout(connectSfuWithLocalMediaStream, 1000);
        } else {
          this._connector
            .connect(localMediaStream)
            .then(stream => {
              if (this._connector) {
                this.emit(this._connector.stream ? SFU_CONNECTION_CONNECTED : SFU_CONNECTION_ERROR_FATAL);
              }
            })
            .catch(e => {
              console.error(e);
              this.emit(SFU_CONNECTION_ERROR_FATAL);
              this.enableMicrophone(false);
            })
            .finally(() => {
              if (!this._clientId.includes("PS-")) this.enableMicrophone(false);
              this._poseSync.initSelfAvatarTransform();
            });
        }
      };
      connectSfuWithLocalMediaStream();
    }
  }

  protected async closeConnection(): Promise<void> {
    if (this._connector) {
      await this._connector.disconnect();
      this._connector = null;
    }
    this._remoteMediaStreams.clear();
    this._clientStreamIdPair.clear();
    debug("disconnect()");
    this.emitRTCEvent("info", "Signaling", () => `[close]`);
  }

  /** Hands the stream Sora delivered for a client to the media session once the client is paired with it. */
  private keepRemoteStream(clientId: string) {
    const streamId = this._clientStreamIdPair.get(clientId);
    const stream = streamId ? this._remoteMediaStreams.get(streamId) : null;
    if (stream) this.media.setRemoteStream(clientId, stream);
  }

  /** The own tracks come from the stream the connector was connected with. */
  protected localTracks(kind: string): MediaStreamTrack[] {
    const stream = this._connector?.stream;
    if (!stream) return [];
    return kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
  }

  getLocalMicTrack() {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    return this._connector?.stream?.getAudioTracks()[0];
  }

  getLocalMediaStream() {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    return this._connector?.stream;
  }

  // BridgeCapable implementation
  get isBridgeChannelReady(): boolean {
    return this._connector !== null && this._connectionType !== SFU_CONNECTION_TYPE.RECV;
  }

  get isConnected(): boolean {
    return this._connector !== null;
  }

  /**
   * Sora owns the local stream it was connected with, so the tracks of a new stream are swapped into
   * that stream here instead of through the media session's ledger.
   */
  async setLocalMediaStream(stream: MediaStream, videoContentHintByTrackId: Map<string, string> | null = null) {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    let sawAudio = false;
    let sawVideo = false;
    await Promise.all(
      stream.getTracks().map(async track => {
        if (track.kind === "audio") {
          sawAudio = true;
          if (
            !track.enabled ||
            track.readyState === "ended" ||
            track.id === this.media.localStream?.getAudioTracks()[0].id
          )
            return;
          await this.replaceTrack("microphone", track);
        } else {
          sawVideo = true;
          const contentHint = videoContentHintByTrackId?.get(track.id);
          if (contentHint === MediaDevices.SCREEN) {
            await this.publishTrack("screen", track);
          } else if (contentHint === MediaDevices.CAMERA) {
            await this.publishTrack("camera", track);
          }
        }
      })
    );

    if (!sawAudio) {
    }
    if (!sawVideo) {
      this.unpublishTrack("camera");
      this.unpublishTrack("screen");
    }
    if (this._clientId.includes("PS-")) this.media.rememberLocalStream(stream);

    // TODO: move to other appropriate place
    if (this && this._clientId.includes("PS-") && this._roomId.includes("public_speaking")) {
      this._sendSelfAvatarSrcIntervalId = setInterval(() => this._poseSync.sendSelfAvatarSrc(), 1000);
    }
  }

  protected setMicEnabled(enabled: boolean): boolean {
    if (!this._connector?.stream) return false;
    this._connector.stream.getAudioTracks().forEach(track => track.kind === "audio" && (track.enabled = enabled));
    return true;
  }

  protected micEnabled(): boolean {
    return (
      this._connector?.audio === true &&
      this._connector?.stream?.getAudioTracks()[0]?.enabled === true &&
      this.media.micShouldBeEnabled
    );
  }

  protected async publishTrack(kind: LocalTrackKind, track: MediaStreamTrack): Promise<void> {
    switch (kind) {
      case "microphone":
        this.replaceAudio(track);
        break;
      case "camera":
        await this.replaceVideoWithCamera(track);
        break;
      case "screen":
        await this.replaceVideoWithShare(track);
        break;
    }
  }

  protected async replaceTrack(kind: LocalTrackKind, track: MediaStreamTrack): Promise<void> {
    // Sora has one audio and one video slot, so replacing is the same as publishing
    await this.publishTrack(kind, track);
  }

  protected async unpublishTrack(kind: LocalTrackKind): Promise<void> {
    if (kind === "microphone") return;
    this.stopVideo();
  }

  private replaceAudio(track: MediaStreamTrack) {
    const localMediaStream = this.media.localStream;
    if (localMediaStream) {
      this._connector?.replaceAudioTrack(localMediaStream, track.clone());
    }
  }

  private async replaceVideoWithCamera(track: MediaStreamTrack) {
    const localMediaStream = this.media.localStream;
    if (localMediaStream) {
      track.enabled = true;
      await this._connector?.replaceVideoTrack(localMediaStream, track);
    }
    this._connector?.on("removetrack", e => {
      if (e.track.kind === "video") {
        this.emitRTCEvent("info", "RTC", () => `Camera track ended`);
        this.stopVideo();
      }
    });
  }

  private async replaceVideoWithShare(track: MediaStreamTrack) {
    const localMediaStream = this.media.localStream;
    if (localMediaStream) {
      track.enabled = true;
      await this._connector?.replaceVideoTrack(localMediaStream, track);
    }
    this._connector?.on("removetrack", e => {
      if (e.track.kind === "video") {
        console.log("Remove video track");
        this.emitRTCEvent("info", "RTC", () => `Desktop Share transport track ended`);
        this.stopVideo();
      }
    });
  }

  private stopVideo() {
    if (this._connector?.stream) {
      this._connector?.stopVideoTrack(this._connector.stream);
    }
  }

  kick(clientId: string) {
    document.body.dispatchEvent(new CustomEvent("kicked", { detail: { clientId: clientId } }));
  }

  block(clientId: string) {
    const streamId = this._clientStreamIdPair.get(clientId);
    if (streamId) {
      let stream = this._remoteMediaStreams.get(streamId);
      stream?.getTracks().forEach(track => {
        track.enabled = false;
      });
    }
    this._blockedClients.set(clientId, true);
    document.body.dispatchEvent(new CustomEvent("blocked", { detail: { clientId: clientId } }));
  }

  unblock(clientId: string) {
    const streamId = this._clientStreamIdPair.get(clientId);
    if (streamId) {
      let stream = this._remoteMediaStreams.get(streamId);
      stream?.getTracks().forEach(track => {
        track.enabled = true;
      });
    }
    this._blockedClients.delete(clientId);
    document.body.dispatchEvent(new CustomEvent("unblocked", { detail: { clientId: clientId } }));
  }

  protected sendData(label: string, data: Uint8Array) {
    if (!this._connector) return;
    // Throws "Could not find DataChannel for channel ..." for about 1 second after connecting; the bus logs it
    this._connector.sendMessage(label, data);
  }

  emitRTCEvent(level: string, tag: string, msgFunc: () => void) {
    if (!window.APP.store.state.preferences.showRtcDebugPanel) return;
    const time = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "numeric",
      minute: "numeric",
      second: "numeric"
    });
    // @ts-ignore
    this._scene?.emit("rtc_event", { level, tag, time, msg: msgFunc() });
  }
}
