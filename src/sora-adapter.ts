import Sora, * as SoraType from "sora-js-sdk";
import { debug as newDebug } from "debug";
import { SFU_CONNECTION_CONNECTED, SFU_CONNECTION_ERROR_FATAL, SfuAdapter } from "./sfu-adapter";
import { MediaDevices } from "./utils/media-devices-utils";
import { AElement } from "aframe";
import { AvatarObjects, AvatarPart, AvatarTransformBuffer, avatarPartTypes } from "./utils/avatar-transform-buffer";
import { decodeAndSetAvatarTransform, decodePosition, decodeRotation, getAvatarSrc } from "./utils/avatar-utils";
import { loadModel } from "./components/gltf-model-plus";
import { createAvatarEntity, createBoneEntity } from "./bit-systems/avatar-bones-system";
import { BoneType } from "./constants";

const debug = newDebug("naf-dialog-adapter:debug");
const sendStats: any[] = [];
const recvStats: any[] = [];

type ConnectProps = {
  clientId: string;
  channelId: string;
  signalingUrl: string;
  accessToken: string;
  scene: Element;
  debug: boolean;
  options?: SoraType.ConnectionOptions;
};

/* Implementation for using bitECS */
type Vector3 = { x: number; y: number; z: number };
type Quaternion = { x: number; y: number; z: number };
type Transform = { pos: Vector3; rot: Quaternion };
/* End of implementation for using bitECS */

export class SoraAdapter extends SfuAdapter {
  _clientId: string;
  _sendrecv: SoraType.ConnectionPublisher | null;
  _localMediaStream: MediaStream | null;
  _remoteMediaStreams: Map<string, MediaStream | null>;
  _clientStreamIdPair: Map<string, string>;
  _pendingMediaRequests: Map<string, any>;
  _blockedClients: Map<string, boolean>;
  _micShouldBeEnabled: boolean;
  _scene: Element | null;
  _remoteAvatarObjects: Map<string, AvatarObjects>;
  _selfAvatarTransformBuffer: AvatarTransformBuffer;
  _recordStatsId: NodeJS.Timer | null;
  /* Implementation for using bitECS */
  _avatarEid2ClientId: Map<number, string>;
  _clientId2avatarId: Map<string, string>;
  _rootTransformsBuffer: Map<string, Transform>;
  _headTransformsBuffer: Map<string, Transform>;
  _leftHandTransformsBuffer: Map<string, Transform>;
  _rightHandTransformsBuffer: Map<string, Transform>;
  /* End of implementation for using bitECS */

  constructor() {
    super();
    this._clientId = "";
    this._sendrecv = null;
    this._localMediaStream = null;
    this._remoteMediaStreams = new Map<string, MediaStream | null>();
    this._clientStreamIdPair = new Map<string, string>();
    this._pendingMediaRequests = new Map<string, any>();
    this._blockedClients = new Map<string, boolean>();
    this._micShouldBeEnabled = false;
    this._remoteAvatarObjects = new Map<string, AvatarObjects>();
    /* Implementation for using bitECS */
    this._avatarEid2ClientId = new Map<number, string>();
    this._clientId2avatarId = new Map<string, string>();
    this._rootTransformsBuffer = new Map<string, Transform>();
    this._headTransformsBuffer = new Map<string, Transform>();
    this._leftHandTransformsBuffer = new Map<string, Transform>();
    this._rightHandTransformsBuffer = new Map<string, Transform>();
    /* End of implementation for using bitECS */
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
      dataChannels: [
        {
          label: "#avatarId",
          direction: "sendrecv" as SoraType.DataChannelDirection
        },
        {
          label: "#avatar-RIG",
          direction: "sendrecv" as SoraType.DataChannelDirection
        },
        {
          label: "#avatar-HEAD",
          direction: "sendrecv" as SoraType.DataChannelDirection
        },
        {
          label: "#avatar-LEFT",
          direction: "sendrecv" as SoraType.DataChannelDirection
        },
        {
          label: "#avatar-RIGHT",
          direction: "sendrecv" as SoraType.DataChannelDirection
        }
      ]
    };

    this._clientId = clientId;
    this._sendrecv = sora.sendrecv(channelId, metadata, options);
    this._sendrecv.on("notify", event => {
      if (event.event_type === "connection.created") {
        if (event.client_id === this._clientId) {
          this.startRecordStats();
        }

        event.data?.forEach(c => {
          // clients entering this room earlier
          if (c.client_id && c.connection_id && !this._clientStreamIdPair.has(c.client_id)) {
            this._clientStreamIdPair.set(c.client_id, c.connection_id);
            this.resolvePendingMediaRequestForTrack(c.client_id);
            this.setRemoteClientAvatar(c.client_id, false);
          }
        });

        // clients entering this room later
        if (
          event.client_id &&
          event.client_id !== this._clientId &&
          event.connection_id &&
          !this._clientStreamIdPair.has(event.client_id)
        ) {
          this._clientStreamIdPair.set(event.client_id, event.connection_id);
          this.setRemoteClientAvatar(event.client_id, true);
          this.emit("stream_updated", event.client_id, "audio");
          this.emit("stream_updated", event.client_id, "video");
        }
      }
      if (event.event_type === "connection.updated") {
        this.emit("stream_updated", event.client_id, "audio");
        this.emit("stream_updated", event.client_id, "video");
      }
    });
    this._sendrecv.on("track", event => {
      // console.log("track");
      const stream = event.streams[0];
      if (!stream) return;
      // console.log(stream.id);
      if (!this._remoteMediaStreams.has(stream.id)) {
        // console.log("_remoteMediaStreams.set");
        this._remoteMediaStreams.set(stream.id, stream);
      }
    });
    this._sendrecv.on("removetrack", event => {
      // @ts-ignore
      console.log("Track removed: " + event.track.id);
    });
    this._sendrecv.on("datachannel", event => {
      // get self avatar parts
      let getPlayerAvatarIntervalId: NodeJS.Timer;
      const getPlayerAvatar = () => {
        if (this._selfAvatarTransformBuffer) {
          clearInterval(getPlayerAvatarIntervalId);
          return;
        }
        const rig = document.querySelector("#avatar-rig") as AElement;
        const head = document.querySelector("#avatar-pov-node") as AElement;
        const left = document.querySelector("#player-left-controller") as AElement;
        const right = document.querySelector("#player-right-controller") as AElement;
        if (rig && head && left && right) {
          this._selfAvatarTransformBuffer = new AvatarTransformBuffer(this._clientId, rig, head, left, right);
          clearInterval(getPlayerAvatarIntervalId);
        }
      };
      getPlayerAvatarIntervalId = setInterval(getPlayerAvatar, 1000);

      // check self avatar transform periodically, and send message if updated
      const sendAvatarTransform = async () => {
        this.sendSelfAvatarTransform(true);
      };
      setInterval(sendAvatarTransform, 20);
    });
    this._sendrecv.on("message", event => {
      if (event.label === "#avatarId") {
        let [clientId, avatarId] = new TextDecoder().decode(new Uint8Array(event.data)).split("|");

        if (this._clientId2avatarId.has(clientId)) {
          // if avatar id of this client is already recorded
          if (this._clientId2avatarId.get(clientId) === avatarId) return; // if avatar is not changed, ignore it
        } else {
          // if avatar id of this client is not recorded, that means this client is new to this room, so send my avatar id & src to the client
          this.sendSelfAvatarSrc(window.APP.store.state.profile.avatarId);
        }

        // if avatar id of this client is already recorded but with different avatar id (existing client but avatar changed),
        // or avatar id of this client is not recorded (new client to this room),
        // then load the client's avatar's model
        if (clientId !== this._clientId) {
          getAvatarSrc(avatarId).then((avatarSrc: string) => {
            loadModel(avatarSrc).then(gltf => {
              const rootEid = createBoneEntity(APP.world, gltf.scene, BoneType.ROOT);
              const headEid = createBoneEntity(APP.world, gltf.scene, BoneType.HEAD);
              const leftHandEid = createBoneEntity(APP.world, gltf.scene, BoneType.LEFT_HAND);
              const rightHandEid = createBoneEntity(APP.world, gltf.scene, BoneType.RIGHT_HAND);
              if (rootEid && headEid && leftHandEid && rightHandEid) {
                const avatarEid = createAvatarEntity(
                  APP.world,
                  clientId,
                  this._avatarEid2ClientId,
                  new Map<BoneType, number>([
                    [BoneType.ROOT, rootEid],
                    [BoneType.HEAD, headEid],
                    [BoneType.LEFT_HAND, leftHandEid],
                    [BoneType.RIGHT_HAND, rightHandEid]
                  ])
                );
                if (avatarEid) this._avatarEid2ClientId.set(avatarEid, clientId);
              }
              APP.world.scene.add(gltf.scene);
            });
          });
        }

        // Always record/update the client's avatar ID
        this._clientId2avatarId.set(clientId, avatarId);
      }

      if (event.label.includes("#avatar-")) {
        // receive other clients' avatar transform when updated
        const encodedTransform = new Uint8Array(event.data);

        const clientId = new TextDecoder().decode(encodedTransform.subarray(9));
        const avatarPart = event.label.substring(8) as unknown as AvatarPart;

        const remoteAvatarObjs = this._remoteAvatarObjects.get(clientId); // encodedTransform.subarray(9): encoded clientId
        if (remoteAvatarObjs) {
          decodeAndSetAvatarTransform(encodedTransform, remoteAvatarObjs[avatarPart]); // event.label.substring(8): avatar part
        }

        /* Implementation for using bitECS */
        if (avatarPart === AvatarPart.RIG) {
          this._rootTransformsBuffer.set(clientId, {
            pos: decodePosition(encodedTransform),
            rot: decodeRotation(encodedTransform)
          });
        }
        if (avatarPart === AvatarPart.HEAD) {
          this._headTransformsBuffer.set(clientId, {
            pos: decodePosition(encodedTransform),
            rot: decodeRotation(encodedTransform)
          });
        }
        if (avatarPart === AvatarPart.LEFT) {
          this._leftHandTransformsBuffer.set(clientId, {
            pos: decodePosition(encodedTransform),
            rot: decodeRotation(encodedTransform)
          });
        }
        if (avatarPart === AvatarPart.RIGHT) {
          this._rightHandTransformsBuffer.set(clientId, {
            pos: decodePosition(encodedTransform),
            rot: decodeRotation(encodedTransform)
          });
        }
        /* End of implementation for using bitECS */
      }
    });
    this._scene?.addEventListener("audio_ready", async () => {
      await new Promise(res => setTimeout(res, 1000));
      this.sendSelfAvatarTransform(false);
    });
    this._localMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this._sendrecv
      .connect(this._localMediaStream)
      .then(stream => {
        if (this._sendrecv) {
          this.emit(this._sendrecv.stream ? SFU_CONNECTION_CONNECTED : SFU_CONNECTION_ERROR_FATAL);
        }
      })
      .catch(e => {
        console.error(e);
        this.emit(SFU_CONNECTION_ERROR_FATAL);
        this.enableMicrophone(false);
      })
      .finally(() => this.enableMicrophone(false));
  }

  async disconnect() {
    if (this._sendrecv) {
      await this._sendrecv.disconnect();
      this._sendrecv = null;
    }
    debug("disconnect()");
    // ...
    this.emitRTCEvent("info", "Signaling", () => `[close]`);
  }

  getMediaStream(clientId: string, kind = "audio") {
    let stream: MediaStream | null | undefined = null;
    let streamId: string | null | undefined = null;
    let tracks: MediaStreamTrack[] | null | undefined = null;

    if (this._clientId === clientId) {
      stream = this._sendrecv?.stream;
    } else {
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
    } else {
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
    return this._sendrecv?.stream?.getAudioTracks()[0];
  }

  getLocalMediaStream() {
    return this._sendrecv?.stream;
  }

  async setLocalMediaStream(stream: MediaStream, videoContentHintByTrackId: Map<string, string> | null = null) {
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
            this._sendrecv?.replaceAudioTrack(this._localMediaStream, track.clone());
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
    if (this._sendrecv?.stream) {
      this._sendrecv.stream.getAudioTracks().forEach(track => track.kind === "audio" && (track.enabled = enabled));
      this._micShouldBeEnabled = enabled;
      this.emit("mic-state-changed", { enabled: this._micShouldBeEnabled });
    }
  }

  get isMicEnabled() {
    return (
      this._sendrecv?.audio === true &&
      this._sendrecv?.stream?.getAudioTracks()[0]?.enabled === true &&
      this._micShouldBeEnabled
    );
  }

  async enableCamera(track: MediaStreamTrack) {
    if (this._localMediaStream) {
      track.enabled = true;
      await this._sendrecv?.replaceVideoTrack(this._localMediaStream, track);
    }
    this._sendrecv?.on("removetrack", e => {
      if (e.track.kind === "video") {
        this.emitRTCEvent("info", "RTC", () => `Camera track ended`);
        this.disableCamera();
      }
    });
  }

  async disableCamera() {
    if (this._sendrecv?.stream) {
      this._sendrecv?.stopVideoTrack(this._sendrecv.stream);
    }
  }

  async enableShare(track: MediaStreamTrack) {
    if (this._localMediaStream) {
      track.enabled = true;
      await this._sendrecv?.replaceVideoTrack(this._localMediaStream, track);
    }
    this._sendrecv?.on("removetrack", e => {
      if (e.track.kind === "video") {
        this.emitRTCEvent("info", "RTC", () => `Desktop Share transport track ended`);
        this.disableCamera();
      }
    });
  }

  async disableShare() {
    if (this._sendrecv?.stream) {
      this._sendrecv?.stopVideoTrack(this._sendrecv.stream);
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

  // Keep trying to retrieve remote client avatar every second until retrieved
  setRemoteClientAvatar(clientId: string, isNewClient: boolean) {
    let intervalId: NodeJS.Timer;
    const trySetRemoteAvatar = () => {
      const remoteClientAvatar = document.querySelector(`[client-id="${clientId}"]`);
      if (remoteClientAvatar && clientId) {
        const parts: AvatarObjects = {
          [AvatarPart.RIG]: (remoteClientAvatar as AElement).object3D,
          [AvatarPart.HEAD]: (remoteClientAvatar.querySelector(".camera") as AElement).object3D,
          [AvatarPart.LEFT]: (remoteClientAvatar.querySelector(".left-controller") as AElement).object3D,
          [AvatarPart.RIGHT]: (remoteClientAvatar.querySelector(".right-controller") as AElement).object3D
        };
        this._remoteAvatarObjects.set(clientId, parts);
        if (isNewClient) this.sendSelfAvatarTransform(false);
        clearInterval(intervalId);
      }
    };
    intervalId = setInterval(trySetRemoteAvatar, 1000);
  }

  sendSelfAvatarTransform(checkUpdatedRequired: boolean) {
    if (!this._selfAvatarTransformBuffer) return;
    avatarPartTypes.forEach(part => {
      if (!checkUpdatedRequired || this._selfAvatarTransformBuffer?.updateAvatarTransform(part)) {
        const arrToSend = this._selfAvatarTransformBuffer.getEncodedAvatarTransform(part);
        this._sendrecv?.sendMessage("#avatar-" + AvatarPart[part], new Uint8Array(arrToSend));
      }
    });
  }

  sendSelfAvatarSrc(avatarId: string) {
    this._sendrecv?.sendMessage("#avatarId", new TextEncoder().encode(this._clientId + "|" + avatarId));
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

  startRecordStats() {
    this._recordStatsId = setInterval(async () => {
      (await this._sendrecv?.pc?.getStats())?.forEach(stat => {
        if (stat.type === "outbound-rtp") {
          sendStats.push({
            id: stat.id,
            kind: stat.kind,
            timestamp: stat.timestamp,
            bytes: stat.bytesSent
          });
        }
        if (stat.type === "inbound-rtp") {
          recvStats.push({
            id: stat.id,
            kind: stat.kind,
            timestamp: stat.timestamp,
            bytes: stat.bytesReceived
          });
        }
      });
      if (sendStats.length > 10000) sendStats.shift();
      if (recvStats.length > 10000) recvStats.shift();
    }, 3000);
  }

  downloadRecordedStats() {
    const currentTimestamp = Date.now();

    const sendStatsBlob = new Blob([JSON.stringify(sendStats)], { type: "text/json" });
    const sendStatslink = document.createElement("a");
    document.body.appendChild(sendStatslink);
    sendStatslink.href = window.URL.createObjectURL(sendStatsBlob);
    sendStatslink.setAttribute("download", "sendStats_sora_" + currentTimestamp + ".json");
    sendStatslink.click();
    document.body.removeChild(sendStatslink);

    const recvStatsBlob = new Blob([JSON.stringify(recvStats)], { type: "text/json" });
    const recvStatsLink = document.createElement("a");
    document.body.appendChild(recvStatsLink);
    recvStatsLink.href = window.URL.createObjectURL(recvStatsBlob);
    recvStatsLink.setAttribute("download", "recvStats_sora_" + currentTimestamp + ".json");
    recvStatsLink.click();
    document.body.removeChild(recvStatsLink);
  }
}
