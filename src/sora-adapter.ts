import Sora, * as SoraType from "sora-js-sdk";
import { debug as newDebug } from "debug";
import { SFU_CONNECTION_CONNECTED, SFU_CONNECTION_ERROR_FATAL, SfuAdapter } from "./sfu-adapter";
import { MediaDevices } from "./utils/media-devices-utils";
import { AElement } from "aframe";
import { AvatarObjects, AvatarPart, AvatarTransformBuffer, avatarPartTypes } from "./utils/avatar-transform-buffer";
import { decodeAndSetAvatarTransform } from "./utils/avatar-utils";

const debug = newDebug("naf-dialog-adapter:debug");

type ConnectProps = {
  clientId: string;
  channelId: string;
  signalingUrl: string;
  accessToken: string;
  scene: Element;
  debug: boolean;
  options?: SoraType.ConnectionOptions;
}

export class SoraAdapter extends SfuAdapter {
  _clientId: string;
  _sendrecv: SoraType.ConnectionPublisher | null;
  _localMediaStream: MediaStream | null;
  _remoteMediaStreams: Map<string, MediaStream | null>;
  _clientStreamIdPair: Map<string, string>;
  _blockedClients: Map<string, boolean>;
  _micShouldBeEnabled: boolean;
  _scene: Element | null;
  _avatarRig: AElement | null;
  _avatarHead: AElement | null;
  _leftController: AElement | null;
  _rightController: AElement | null;
  _remoteAvatarObjects: Map<string, AvatarObjects>;
  _selfAvatarTransformBuffer: AvatarTransformBuffer;

  constructor() {
    super();
    this._clientId = "";
    this._sendrecv = null;
    this._localMediaStream = null;
    this._remoteMediaStreams = new Map<string, MediaStream | null>();
    this._clientStreamIdPair = new Map<string, string>();
    this._blockedClients = new Map<string, boolean>();
    this._micShouldBeEnabled = false;
    this._avatarRig = null;
    this._avatarHead = null;
    this._leftController = null;
    this._rightController = null;
    this._remoteAvatarObjects = new Map<string, AvatarObjects>();
  }

  async connect({ clientId, channelId, signalingUrl, accessToken, scene, debug }: ConnectProps) {
    this._scene = scene;
    const sora = Sora.connection(signalingUrl, debug);
    const metadata = { access_Token: accessToken };
    const options = {
      clientId: clientId,
      multistream: true,
      audio: true,
      video: true,
      dataChannelSignaling: true,
      dataChannels: [
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
        event.data?.forEach(c => {
          // clients entering this room earlier
          if (c.client_id && c.connection_id) {
            if (!this._clientStreamIdPair.has(c.client_id)) {
              this._clientStreamIdPair.set(c.client_id, c.connection_id);
            }
            this.setRemoteClientAvatar(c.client_id, false);
          }
        });
        
        // clients entering this room later
        if (event.client_id && event.client_id !== this._clientId && event.connection_id) {
          if (!this._remoteMediaStreams.has(event.client_id)) {
            this._clientStreamIdPair.set(event.client_id, event.connection_id);
          }
          this.setRemoteClientAvatar(event.client_id, true);
          
          this.emit("stream_updated", event.client_id, "audio");
          this.emit("stream_updated", event.client_id, "video");
        }
      }
      if (event.event_type === "connection.updated") {
        this.emit("stream_updated", event.client_id, "audio");
        this.emit("stream_updated", event.client_id, "video");
      }
    })
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
      }
      getPlayerAvatarIntervalId = setInterval(getPlayerAvatar, 1000);

      // check self avatar transform periodically, and send message if updated
      const sendAvatarTransform = async () => {
        this.sendSelfAvatarTransform(true);
      }
      setInterval(sendAvatarTransform, 20);
    });
    this._sendrecv.on("message", event => {
      if (event.label.includes("#avatar-")) {
        // receive other clients' avatar transform when updated
        const encodedTransform = new Uint8Array(event.data);
        const remoteAvatarObjs = this._remoteAvatarObjects.get(new TextDecoder().decode(encodedTransform.subarray(9))); // encodedTransform.subarray(9): encoded clientId
        if (remoteAvatarObjs) decodeAndSetAvatarTransform(encodedTransform, remoteAvatarObjs[event.label.substring(8) as unknown as AvatarPart]); // event.label.substring(8): avatar part
      }
    });
    this._scene?.addEventListener("audio_ready", async () => {
      await new Promise(res => setTimeout(res, 1000));
      this.sendSelfAvatarTransform(false);
    });
    this._localMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
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
    let tracks: MediaStreamTrack[] | null | undefined = null;

    if (this._clientId === clientId) {
      stream = this._sendrecv?.stream;
    } else {
      const streamId = this._clientStreamIdPair.get(clientId);
      if (streamId) {
        stream = this._remoteMediaStreams.get(streamId);
      }
    }

    if (stream) {
      tracks = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
      if (tracks) {
        const promise = Promise.resolve(new MediaStream(tracks));
        promise.catch(e => {
          this.emitRTCEvent("error", "Adapter", () => `getMediaStream error: ${e}`);
          console.warn(`${clientId} getMediaStream Error`, e);
        });
        return promise;
      }
    }

    return null;
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
          if (this._sendrecv) {
            if (this._sendrecv.stream) {
              this._sendrecv.replaceAudioTrack(this._sendrecv.stream, track);
            } else {
              this._sendrecv.stream = new MediaStream([track]);
            }
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
    if (this._sendrecv) this._sendrecv.stream = stream;
  }

  toggleMicrophone() {
    if (this._micShouldBeEnabled) {
      this.enableMicrophone(false);
    } else {
      this.enableMicrophone(true);
    }
  }

  enableMicrophone(enabled: boolean) {
    if (this._sendrecv?.stream){
      this._sendrecv.stream.getAudioTracks().forEach(track => track.kind === "audio" && (track.enabled = enabled));
      this._micShouldBeEnabled = enabled;
      this.emit("mic-state-changed", { enabled: this._micShouldBeEnabled });
    }
  }

  get isMicEnabled() {
    return this._sendrecv?.audio === true
      && this._sendrecv?.stream?.getAudioTracks()[0]?.enabled === true
      && this._micShouldBeEnabled;
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
    })
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
    })
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
        }
        this._remoteAvatarObjects.set(clientId, parts);
        if (isNewClient) this.sendSelfAvatarTransform(false);
        clearInterval(intervalId);
      }
    }
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
