import Sora, * as SoraType from "sora-js-sdk";
import { debug as newDebug } from "debug";
import { SFU_CONNECTION_CONNECTED, SFU_CONNECTION_ERROR_FATAL, SfuAdapter } from "./sfu-adapter";
import { MediaDevices } from "./utils/media-devices-utils";
import { AvatarSyncHelper } from "./utils/avatar-sync-helper";
import { CrossRoomStreamerAudioSource } from "./components/cross-room-streamer-audio-source";
import { SFU, SFU_CONNECTION_TYPE } from "./sfu-types";
import { Object3D } from "three";

const debug = newDebug("naf-dialog-adapter:debug");

type ConnectProps = {
  clientId: string;
  channelId: string;
  signalingUrl: string | string[];
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
  _signalingUrl?: string | string[];
  _accessToken?: string;
  crossRoomStreamerAudioSource: { [clientId: string]: CrossRoomStreamerAudioSource };
  private _laserPointer: Object3D;

  constructor(sfuType = SFU_CONNECTION_TYPE.SENDRECV) {
    super();
    this._sfuId = SFU.SORA;
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
    this._dataChannelMessages = [];
    this._recordedDataChannelMessages = [];
    this.crossRoomStreamerAudioSource = {};
    this._publicSpeakerClientIdsInRoom = [];
  }

  async connect({ clientId, channelId, signalingUrl, accessToken, scene, debug }: ConnectProps) {
    this._scene = scene;
    this._roomId = channelId;
    this._signalingUrl = signalingUrl;
    this._accessToken = accessToken;
    const sora = Sora.connection(signalingUrl, debug);
    const metadata = { access_token: accessToken };
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
      dataChannels: this._avatarSyncHelper._channelsForSync
        .map(channel => ({
          label: channel,
          direction:
            this._connectionType === SFU_CONNECTION_TYPE.RECV
              ? ("recvonly" as SoraType.DataChannelDirection)
              : ((this._connectionType === SFU_CONNECTION_TYPE.SEND
                  ? "sendonly"
                  : "sendrecv") as SoraType.DataChannelDirection)
        }))
        .concat([
          {
            label: "#pdfPage",
            direction: this._connectionType === SFU_CONNECTION_TYPE.SEND ? "sendonly" : "recvonly"
          },
          {
            label: "#laserPointer",
            direction: "sendrecv"
          }
        ])
        .concat(
          this._connectionType === SFU_CONNECTION_TYPE.SENDRECV
            ? [
                {
                  label: "#togglePublicSpeaker",
                  direction: "sendrecv"
                }
              ]
            : []
        )
      // .concat(other channels if necessary)
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
            this.tryAttachAudioToPublicSpeakerAgent(c.client_id, c.connection_id);
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
          // this._avatarSyncHelper.sendSelfAvatarTransform(false);
          this.tryAttachAudioToPublicSpeakerAgent(event.client_id, event.connection_id);
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
      });
      this._connector.on("removetrack", event => {
        console.log("Track removed: " + event.track.id);
        const stream = event.target;
        if (!stream) return;
        for (let [clientId, streamId] of this._clientStreamIdPair.entries()) {
          // @ts-ignore
          if (streamId === event.target?.id) {
            this._clientStreamIdPair.delete(clientId);
          }
        }
      });
      this._connector.on("message", event => {
        this._dataChannelMessages.push({ channelLabel: event.label, message: event.data });
        if (this._isRecording) this._recordedDataChannelMessages.push({ l: event.label, m: event.data, t: Date.now() });
        while (this._dataChannelMessages.length > 100) this._dataChannelMessages.shift();
        this._avatarSyncHelper.handleRecvMessage(event.label, new Uint8Array(event.data));

        if (event.label === "#pdfPage") {
          this.emit("pdf-page-changed-in-public-speaker-room", { message: new TextDecoder().decode(event.data) });
        }

        if (event.label === "#togglePublicSpeaker") {
          this.emit("toggle-public-speaker", { message: new TextDecoder().decode(event.data) });
        }

        if (event.label === "#laserPointer" && this._connectionType !== SFU_CONNECTION_TYPE.RECV) {
          if (this._laserPointer) {
            const message = new TextDecoder().decode(event.data);
            const position = message.split("|");
            if (position) {
              this._laserPointer.visible = position[0] !== "0" || position[1] !== "0" || position[2] !== "0";
              this._laserPointer.position.set(
                parseFloat(position[0]),
                parseFloat(position[1]),
                parseFloat(position[2])
              );
              this._laserPointer.updateMatrix();
            }
          } else {
            const sphere = new THREE.SphereGeometry(0.2);
            const object = new THREE.Mesh(
              sphere,
              new THREE.MeshBasicMaterial({ color: "#ff0000", transparent: true, opacity: 0.7 })
            );
            this._laserPointer = object;
            APP.world.scene.add(this._laserPointer);
          }
        }
      });
    }

    if (this._connectionType !== SFU_CONNECTION_TYPE.RECV) {
      this._connector.on("datachannel", event => {
        if (!this._clientId.includes("PS-") || this._roomId.includes("public_speaking")) {
          this._avatarSyncHelper.handleSyncInit(event.datachannel.label);
        }
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
      if (!this._clientId.includes("PS-"))
        this._localMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

      const connectSfuWithLocalMediaStream = () => {
        if (!this._connector || !this._localMediaStream) {
          window.setTimeout(connectSfuWithLocalMediaStream, 1000);
        } else {
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
              if (!this._clientId.includes("PS-")) this.enableMicrophone(false);
              this._avatarSyncHelper.initSelfAvatarTransform();
            });
        }
      };
      connectSfuWithLocalMediaStream();
    }
  }

  async disconnect() {
    if (this._connector) {
      await this._connector.disconnect();
      this._connector = null;
    }
    if (this._sendSelfAvatarSrcIntervalId) clearInterval(this._sendSelfAvatarSrcIntervalId);
    this._avatarSyncHelper?.stopSyncing();
    debug("disconnect()");
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

  getDataChannelMessage() {
    return this._dataChannelMessages && this._dataChannelMessages.length > 0
      ? this._dataChannelMessages.shift()
      : { channelLabel: "", message: null };
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
    if (this._clientId.includes("PS-")) this._localMediaStream = stream;

    // TODO: move to other appropriate place
    if (this && this._clientId.includes("PS-") && this._roomId.includes("public_speaking")) {
      this._sendSelfAvatarSrcIntervalId = setInterval(() => this._avatarSyncHelper.sendSelfAvatarSrc(), 1000);
    }
  }

  setLocalDataChannelMessage({ channelLabel, message }: { channelLabel: string; message: ArrayBuffer }) {
    if (!channelLabel || !message) return;
    this.broadcastUint8(channelLabel, new Uint8Array(message));
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
        console.log("Remove video track");
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
    if (!this._connector || this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    try {
      this._connector.sendMessage(channel, new TextEncoder().encode(message));
      this._recordedDataChannelMessages.push({ l: channel, m: new TextEncoder().encode(message), t: Date.now() });
    } catch (error) {
      console.error(error);
    }
  }

  broadcastUint8(channel: string, message: Uint8Array) {
    if (!this._connector || this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    try {
      this._connector.sendMessage(channel, message);
      this._recordedDataChannelMessages.push({ l: channel, m: message, t: Date.now() });
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

  private async tryAttachAudioToPublicSpeakerAgent(remoteClientId: string, streamId: string) {
    if (remoteClientId.includes("PS-") && !this._roomId.includes("public_speaking")) {
      // const stream = this._remoteMediaStreams.get(streamId);
      const stream = await this.getMediaStream(remoteClientId, "audio")?.catch(e => {
        console.error(`Error getting audio stream for ${remoteClientId}`, e);
      });
      if (!stream) return;
      // @ts-ignore
      this.crossRoomStreamerAudioSource[remoteClientId] = new CrossRoomStreamerAudioSource(
        // @ts-ignore
        new MediaStream(stream)
      );
      const tryAttachAudioToAvatar = () => {
        const avatarEid = this._avatarSyncHelper._client2AvatarEid.get(remoteClientId);
        if (avatarEid) {
          const avatarObj = APP.world.eid2obj.get(avatarEid);
          if (avatarObj) {
            this.crossRoomStreamerAudioSource[remoteClientId].attachAudio(avatarObj);
          }
        }
        if (!this.crossRoomStreamerAudioSource[remoteClientId].node) {
          window.setTimeout(tryAttachAudioToAvatar, 1000);
        }
      };

      tryAttachAudioToAvatar();
    }
  }
}
