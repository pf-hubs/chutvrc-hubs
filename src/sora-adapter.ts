import Sora, * as SoraType from "sora-js-sdk";
import { debug as newDebug } from "debug";
import { SFU_CONNECTION_CONNECTED, SFU_CONNECTION_ERROR_FATAL, SfuAdapter } from "./sfu-adapter";
import { MediaDevices } from "./utils/media-devices-utils";
import { AvatarSyncHelper } from "./utils/avatar-sync-helper";
import { CrossRoomStreamerAudioSource } from "./components/cross-room-streamer-audio-source";
import { SFU_CONNECTION_TYPE } from "./sfu-types";
const debug = newDebug("naf-dialog-adapter:debug");

type ConnectProps = {
  clientId: string;
  channelId: string;
  signalingUrl: string;
  accessToken: string;
  scene: Element;
  debug: boolean;
  options?: SoraType.ConnectionOptions;
};

export class SoraAdapter extends SfuAdapter {
  _connector: SoraType.ConnectionPublisher | SoraType.ConnectionSubscriber | null;
  _localMediaStream: MediaStream | null;
  _remoteMediaStreams: Map<string, MediaStream | null>;
  _clientStreamIdPair: Map<string, string>;
  _pendingMediaRequests: Map<string, any>;
  _blockedClients: Map<string, boolean>;
  _micShouldBeEnabled: boolean;
  _scene: Element | null;
  _avatarSyncHelper: AvatarSyncHelper;
  crossRoomStreamerAudioSource: CrossRoomStreamerAudioSource;

  constructor(sfuType = SFU_CONNECTION_TYPE.SENDRECV) {
    super();
    this._connectionType = sfuType;
    this._clientId = "";
    this._connector = null;
    this._localMediaStream = null;
    this._remoteMediaStreams = new Map<string, MediaStream | null>();
    this._clientStreamIdPair = new Map<string, string>();
    this._pendingMediaRequests = new Map<string, any>();
    this._blockedClients = new Map<string, boolean>();
    this._micShouldBeEnabled = false;
    this._avatarSyncHelper = new AvatarSyncHelper(this);
  }

  async connect({ clientId, channelId, signalingUrl, accessToken, scene, debug }: ConnectProps) {
    this._scene = scene;
    const sora = Sora.connection(signalingUrl, debug);
    const metadata = { access_token: accessToken };
    const options = {
      clientId: clientId,
      multistream: true,
      spotlight: true,
      audio: true,
      video: true,
      audioCodecType: "OPUS" as SoraType.AudioCodecType,
      videoCodecType: "H264" as SoraType.VideoCodecType,
      dataChannelSignaling: true,
      dataChannels: this._avatarSyncHelper._channelsForSync.map(channel => ({
        label: channel,
        direction:
          this._connectionType === SFU_CONNECTION_TYPE.RECV
            ? ("recvonly" as SoraType.DataChannelDirection)
            : ((this._connectionType === SFU_CONNECTION_TYPE.SEND
                ? "sendonly"
                : "sendrecv") as SoraType.DataChannelDirection)
      })) // .concat(other channels if necessary)
    };

    this._clientId = clientId;
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
            this.resolvePendingMediaRequestForTrack(c.client_id);
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
          // this._avatarSyncHelper.sendSelfAvatarTransform(false);
          this.emit("stream_updated", event.client_id, "audio");
          this.emit("stream_updated", event.client_id, "video");
        }

        if (this._connectionType !== SFU_CONNECTION_TYPE.RECV) this._avatarSyncHelper.sendSelfAvatarTransform(false);
      }

      if (this._connectionType !== SFU_CONNECTION_TYPE.SEND) {
        if (event.event_type === "connection.updated") {
          this.emit("stream_updated", event.client_id, "audio");
          this.emit("stream_updated", event.client_id, "video");
        }
        if (event.event_type === "connection.destroyed" && event.client_id) {
          this._avatarSyncHelper.handleOnClientLeave(event.client_id);
        }
      }
    });

    if (this._connectionType !== SFU_CONNECTION_TYPE.SEND) {
      this._connector.on("track", event => {
        const stream = event.streams[0];
        if (!stream) return;
        if (!this._remoteMediaStreams.has(stream.id)) {
          this._remoteMediaStreams.set(stream.id, stream);
        }
        this.crossRoomStreamerAudioSource = new CrossRoomStreamerAudioSource(new MediaStream(stream.getAudioTracks()));
      });
      this._connector.on("removetrack", event => {
        // @ts-ignore
        console.log("Track removed: " + event.track.id);
      });
      this._connector.on("message", event => {
        this._avatarSyncHelper.handleRecvMessage(event.label, new Uint8Array(event.data));
      });
    }

    if (this._connectionType !== SFU_CONNECTION_TYPE.RECV) {
      this._connector.on("datachannel", event => {
        this._avatarSyncHelper.handleSyncInit(event.datachannel.label);
      });
      this._scene?.addEventListener("audio_ready", async () => {
        await new Promise(res => setTimeout(res, 1000));
        this._avatarSyncHelper.sendSelfAvatarTransform(false);
      });
    }

    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) {
      // @ts-ignore
      this._connector.connect();
    } else {
      this._localMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this._connector
        .connect(this._localMediaStream)
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
          this.enableMicrophone(false);
          this._avatarSyncHelper.initSelfAvatarTransform();
        });
    }
  }

  async disconnect() {
    if (this._connector) {
      await this._connector.disconnect();
      this._connector = null;
    }
    debug("disconnect()");
    // ...
    this.emitRTCEvent("info", "Signaling", () => `[close]`);
  }

  getMediaStream(clientId: string, kind = "audio") {
    let stream: MediaStream | null | undefined = null;
    let streamId: string | null | undefined = null;
    let tracks: MediaStreamTrack[] | null | undefined = null;

    var isSelfStreamRetrievable = this._clientId === clientId && this._connectionType !== SFU_CONNECTION_TYPE.RECV;
    var isOtherStreamRetrievable = this._clientId !== clientId && this._connectionType !== SFU_CONNECTION_TYPE.SEND;

    if (isSelfStreamRetrievable) {
      stream = this._connector?.stream;
    } else if (isOtherStreamRetrievable) {
      streamId = this._clientStreamIdPair.get(clientId);
      if (streamId) {
        stream = this._remoteMediaStreams.get(streamId);
      }
    }

    if (stream) {
      debug(`Already had ${kind} for ${clientId}`);
      tracks = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
      if (tracks) {
        const promise = Promise.resolve(new MediaStream(tracks));
        promise.catch(e => {
          this.emitRTCEvent("error", "Adapter", () => `getMediaStream error: ${e}`);
          console.warn(`${clientId} getMediaStream Error`, e);
        });
        return promise;
      }
    } else if (isSelfStreamRetrievable || isOtherStreamRetrievable) {
      console.log(`Waiting on ${kind} for ${clientId}`);
      debug(`Waiting on ${kind} for ${clientId}`);
      if (!this._pendingMediaRequests.has(clientId)) {
        this._pendingMediaRequests.set(clientId, {});
      }

      const requests = this._pendingMediaRequests.get(clientId);
      const promise = new Promise((resolve, reject) => (requests[kind] = { resolve, reject }));
      requests[kind].promise = promise;
      promise.catch(e => {
        this.emitRTCEvent("error", "Adapter", () => `getMediaStream error: ${e}`);
        console.warn(`${clientId} getMediaStream Error`, e);
      });
      return promise;
    }
  }

  getLocalMicTrack() {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    return this._connector?.stream?.getAudioTracks()[0];
  }

  getLocalMediaStream() {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    return this._connector?.stream;
  }

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
            track.id === this._localMediaStream?.getAudioTracks()[0].id
          )
            return;
          if (this._localMediaStream) {
            this._connector?.replaceAudioTrack(this._localMediaStream, track.clone());
          }
        } else {
          sawVideo = true;
          const contentHint = videoContentHintByTrackId?.get(track.id);
          if (contentHint === MediaDevices.SCREEN) {
            await this.enableShare(track);
          } else if (contentHint === MediaDevices.CAMERA) {
            await this.enableCamera(track);
          }
        }
      })
    );

    if (!sawAudio) {
    }
    if (!sawVideo) {
      this.disableCamera();
      this.disableShare();
    }
  }

  toggleMicrophone() {
    if (this._micShouldBeEnabled) {
      this.enableMicrophone(false);
    } else {
      this.enableMicrophone(true);
    }
  }

  enableMicrophone(enabled: boolean) {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    if (this._connector?.stream) {
      this._connector.stream.getAudioTracks().forEach(track => track.kind === "audio" && (track.enabled = enabled));
      this._micShouldBeEnabled = enabled;
      this.emit("mic-state-changed", { enabled: this._micShouldBeEnabled });
    }
  }

  get isMicEnabled() {
    return (
      this._connectionType !== SFU_CONNECTION_TYPE.RECV &&
      this._connector?.audio === true &&
      this._connector?.stream?.getAudioTracks()[0]?.enabled === true &&
      this._micShouldBeEnabled
    );
  }

  async enableCamera(track: MediaStreamTrack) {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    if (this._localMediaStream) {
      track.enabled = true;
      await this._connector?.replaceVideoTrack(this._localMediaStream, track);
    }
    this._connector?.on("removetrack", e => {
      if (e.track.kind === "video") {
        this.emitRTCEvent("info", "RTC", () => `Camera track ended`);
        this.disableCamera();
      }
    });
  }

  async disableCamera() {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    if (this._connector?.stream) {
      this._connector?.stopVideoTrack(this._connector.stream);
    }
  }

  async enableShare(track: MediaStreamTrack) {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    if (this._localMediaStream) {
      track.enabled = true;
      await this._connector?.replaceVideoTrack(this._localMediaStream, track);
    }
    this._connector?.on("removetrack", e => {
      if (e.track.kind === "video") {
        this.emitRTCEvent("info", "RTC", () => `Desktop Share transport track ended`);
        this.disableCamera();
      }
    });
  }

  async disableShare() {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
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

  broadcast(channel: string, message: string) {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    try {
      this._connector?.sendMessage(channel, new TextEncoder().encode(message));
    } catch (error) {
      console.error(error);
    }
  }

  broadcastUint8(channel: string, message: Uint8Array) {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    try {
      this._connector?.sendMessage(channel, message);
    } catch (error) {
      console.error(error);
    }
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

  resolvePendingMediaRequestForTrack(clientId: string) {
    if (this._connectionType === SFU_CONNECTION_TYPE.SEND) return;

    const requests = this._pendingMediaRequests.get(clientId);
    const streamId = this._clientStreamIdPair.get(clientId);
    if (streamId) {
      const stream = this._remoteMediaStreams.get(streamId);
      if (stream && requests) {
        if (requests["audio"]) {
          const resolve = requests["audio"].resolve;
          delete requests["audio"];
          resolve(new MediaStream(stream.getAudioTracks()));
        }
        if (requests["video"]) {
          const resolve = requests["video"].resolve;
          delete requests["video"];
          resolve(new MediaStream(stream.getVideoTracks()));
        }
      }
    }

    if (requests && Object.keys(requests).length === 0) {
      this._pendingMediaRequests.delete(clientId);
    }
  }
}
