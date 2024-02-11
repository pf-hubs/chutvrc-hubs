import Sora, * as SoraType from "sora-js-sdk";
import { debug as newDebug } from "debug";
import { SFU_CONNECTION_CONNECTED, SFU_CONNECTION_ERROR_FATAL, SfuAdapter } from "./sfu-adapter";
import { MediaDevices } from "./utils/media-devices-utils";
import { AElement } from "aframe";
import { AvatarObjects, AvatarPart, AvatarTransformBuffer, avatarPartTypes } from "./utils/avatar-transform-buffer";
import {
  decodeAndSetAvatarTransform,
  decodePosition,
  decodeRotation,
  decodeRotation2,
  getAvatarSrc
} from "./utils/avatar-utils";
import { loadModel } from "./components/gltf-model-plus";
import { createAvatarBoneEntities, removeAvatarEntityAndModel } from "./bit-systems/avatar-bones-system";
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
  /* Implementation for using bitECS */
  _avatarEid2ClientId: Map<number, string>;
  _clientId2AvatarEid: Map<string, number>;
  _clientId2avatarId: Map<string, string>;
  _clientId2isVR: Map<string, boolean>;
  _rootTransformsBuffer: Map<string, Transform>;
  _headTransformsBuffer: Map<string, Transform>;
  _leftHandTransformsBuffer: Map<string, Transform>;
  _rightHandTransformsBuffer: Map<string, Transform>;
  /* End of implementation for using bitECS */
  _rightHand: AElement;

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
    this._clientId2AvatarEid = new Map<string, number>();
    this._clientId2avatarId = new Map<string, string>();
    this._clientId2isVR = new Map<string, boolean>();
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
        },
        {
          label: "#isVR",
          direction: "sendrecv" as SoraType.DataChannelDirection
        }
      ]
    };

    this._clientId = clientId;
    this._sendrecv = sora.sendrecv(channelId, metadata, options);
    this._sendrecv.on("notify", event => {
      if (event.event_type === "connection.created") {
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
      if (event.event_type === "connection.destroyed" && event.client_id) {
        removeAvatarEntityAndModel(APP.world, this._clientId2AvatarEid.get(event.client_id));
      }
    });
    this._sendrecv.on("track", event => {
      const stream = event.streams[0];
      if (!stream) return;
      if (!this._remoteMediaStreams.has(stream.id)) {
        this._remoteMediaStreams.set(stream.id, stream);
      }
    });
    this._sendrecv.on("removetrack", event => {
      // @ts-ignore
      console.log("Track removed: " + event.track.id);
    });
    this._sendrecv.on("datachannel", event => {
      if (event.datachannel.label === "#avatar-RIG") {
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
          this._rightHand = right;
          if (rig && head && left && right) {
            this._selfAvatarTransformBuffer = new AvatarTransformBuffer(this._clientId, rig, head, left, right);
            clearInterval(getPlayerAvatarIntervalId);
          }
        };
        getPlayerAvatarIntervalId = setInterval(getPlayerAvatar, 1000);
      }

      if (event.datachannel.label === "#isVR") {
        setInterval(() => this.setSelfIsVrFlag(), 1000);
        setInterval(() => this.sendSelfIsVrFlag(), 1000);
      }

      if (event.datachannel.label.includes("#avatar-")) {
        setInterval(() => this.sendSelfAvatarTransform(true), 20);
      }
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
              var isAvatarBoneEntitiesSuccessfullyCreated = createAvatarBoneEntities(
                APP.world,
                gltf.scene,
                clientId,
                this._avatarEid2ClientId,
                this._clientId2AvatarEid
              );
              if (isAvatarBoneEntitiesSuccessfullyCreated) APP.world.scene.add(gltf.scene);
            });
          });
        }

        // Always record/update the client's avatar ID
        this._clientId2avatarId.set(clientId, avatarId);
      }

      if (event.label === "#isVR") {
        let [clientId, isVR] = new TextDecoder().decode(new Uint8Array(event.data)).split("|");
        this._clientId2isVR.set(clientId, isVR === "1");
      }

      if (event.label.includes("#avatar-")) {
        // receive other clients' avatar transform when updated
        const encodedTransform = new Uint8Array(event.data);

        const clientId = new TextDecoder().decode(encodedTransform.subarray(9));
        const avatarPart = event.label.substring(8) as unknown as AvatarPart;

        // const remoteAvatarObjs = this._remoteAvatarObjects.get(clientId); // encodedTransform.subarray(9): encoded clientId
        // if (remoteAvatarObjs) {
        //   decodeAndSetAvatarTransform(encodedTransform, remoteAvatarObjs[avatarPart]); // event.label.substring(8): avatar part
        // }

        /* Implementation for using bitECS */
        if (avatarPart === AvatarPart.RIG) {
          this._rootTransformsBuffer.set(clientId, {
            pos: decodePosition(encodedTransform),
            rot: decodeRotation2(encodedTransform)
          });
        }
        if (avatarPart === AvatarPart.HEAD) {
          this._headTransformsBuffer.set(clientId, {
            pos: decodePosition(encodedTransform),
            rot: decodeRotation2(encodedTransform)
          });
        }
        if (avatarPart === AvatarPart.LEFT) {
          this._leftHandTransformsBuffer.set(clientId, {
            pos: decodePosition(encodedTransform),
            rot: decodeRotation2(encodedTransform)
          });
        }
        if (avatarPart === AvatarPart.RIGHT) {
          this._rightHandTransformsBuffer.set(clientId, {
            pos: decodePosition(encodedTransform),
            rot: decodeRotation2(encodedTransform)
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
      if (checkUpdatedRequired && !this._selfAvatarTransformBuffer?.updateAvatarTransform(part)) return;

      const arrToSend = this._selfAvatarTransformBuffer.getEncodedAvatarTransform(part);
      this._sendrecv?.sendMessage("#avatar-" + AvatarPart[part], new Uint8Array(arrToSend));
      const decodedTransform = {
        pos: decodePosition(arrToSend),
        rot: decodeRotation(arrToSend)
      };
      /* Implementation for using bitECS */
      if (part === AvatarPart.RIG) {
        this._rootTransformsBuffer.set(this._clientId, decodedTransform);
      }
      if (part === AvatarPart.HEAD) {
        this._headTransformsBuffer.set(this._clientId, decodedTransform);
      }
      if (part === AvatarPart.LEFT) {
        this._leftHandTransformsBuffer.set(this._clientId, decodedTransform);
      }
      if (part === AvatarPart.RIGHT) {
        this._rightHandTransformsBuffer.set(this._clientId, decodedTransform);
      }
      /* End of implementation for using bitECS */
    });
  }

  sendSelfAvatarSrc(avatarId: string) {
    this._sendrecv?.sendMessage("#avatarId", new TextEncoder().encode(this._clientId + "|" + avatarId));
  }

  private setSelfIsVrFlag() {
    this._clientId2isVR.set(
      this._clientId,
      AFRAME.scenes[0].renderer.xr.enabled && AFRAME.scenes[0].renderer.xr.isPresenting
    );
  }

  private sendSelfIsVrFlag() {
    this._sendrecv?.sendMessage(
      "#isVR",
      new TextEncoder().encode(
        this._clientId +
          "|" +
          (AFRAME.scenes[0].renderer.xr.enabled && AFRAME.scenes[0].renderer.xr.isPresenting ? "1" : "0")
      )
    );
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
}
