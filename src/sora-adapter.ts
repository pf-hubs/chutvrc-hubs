import Sora, * as SoraType from "sora-js-sdk";
import { debug as newDebug } from "debug";
import { SFU_CONNECTION_CONNECTED, SFU_CONNECTION_ERROR_FATAL, SfuAdapter } from "./sfu-adapter";
import { MediaDevices } from "./utils/media-devices-utils";
import { floatToUInt8, uInt8ToFloat, radToUInt8, uInt8ToRad } from "./utils/uint8-parser";
import { AElement } from "aframe";

const debug = newDebug("naf-dialog-adapter:debug");

type ConnectProps = {
  clientId: string;
  channelId: string;
  signalingUrl: string;
  accessToken: string;
  debug: boolean;
  options?: SoraType.ConnectionOptions;
}

type AvatarEl = {
  head: AElement | null;
  leftHand: AElement | null;
  rightHand: AElement | null;
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
  _hmd: AElement | null;
  _leftController: AElement | null;
  _rightController: AElement | null;
  _remoteAvatarEls: Map<string, AvatarEl>;

  constructor() {
    super();
    this._clientId = "";
    this._sendrecv = null;
    this._localMediaStream = null;
    this._remoteMediaStreams = new Map<string, MediaStream | null>();
    this._clientStreamIdPair = new Map<string, string>();
    this._blockedClients = new Map<string, boolean>();
    this._micShouldBeEnabled = false;
    this._hmd = null;
    this._leftController = null;
    this._rightController = null;
    this._remoteAvatarEls = new Map<string, AvatarEl>();
  }

  async connect({ clientId, channelId, signalingUrl, accessToken, debug }: ConnectProps) {
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
          label: "#avatar-transform",
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
            const remoteClientAvatar = document.querySelector(`[client-id="${c.client_id}"]`);
            if (remoteClientAvatar) {
              this._remoteAvatarEls.set(c.client_id, {
                head: remoteClientAvatar.querySelector(".camera") as AElement,
                leftHand: remoteClientAvatar.querySelector(".left-controller") as AElement,
                rightHand: remoteClientAvatar.querySelector(".right-controller") as AElement
              })
            }
          }
        });
        // clients entering this room later
        if (event.client_id && event.connection_id) {
          if (!this._remoteMediaStreams.has(event.client_id)) {
            this._clientStreamIdPair.set(event.client_id, event.connection_id);
          }
          let intervalId: NodeJS.Timer;
          const setRemoteAvatar = () => {
            const remoteClientAvatar = document.querySelector(`[client-id="${event.client_id}"]`);
            if (remoteClientAvatar && event.client_id) {
              this._remoteAvatarEls.set(event.client_id, {
                head: remoteClientAvatar.querySelector(".camera") as AElement,
                leftHand: remoteClientAvatar.querySelector(".left-controller") as AElement,
                rightHand: remoteClientAvatar.querySelector(".right-controller") as AElement
              })
            }
            clearInterval(intervalId);
          }
          intervalId = setInterval(setRemoteAvatar, 1000);
          
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
      const clientIdUInt8 = new TextEncoder().encode(this._clientId);
      let intervalId: NodeJS.Timer;
      const getPlayerAvatar = () => {
        this._hmd = document.querySelector("#avatar-pov-node") as AElement;
        this._leftController = document.querySelector("#player-left-controller") as AElement;
        this._rightController = document.querySelector("#player-right-controller") as AElement;
        if (this._hmd && this._leftController && this._rightController) clearInterval(intervalId);
      }
      intervalId = setInterval(getPlayerAvatar, 1000);

      const syncAvatarTransform = async () => {
        if (this._hmd && this._leftController && this._rightController) {
          const headPos = this._hmd?.object3D.position;
          const headRot = this._hmd?.object3D.rotation;
          const leftHandPos = this._leftController?.object3D.position;
          const leftHandRot = this._leftController?.object3D.rotation;
          const rightHandPos = this._rightController?.object3D.position;
          const rightHandRot = this._rightController?.object3D.rotation;
          if (headPos && headRot && leftHandPos && leftHandRot && rightHandPos && rightHandRot) {
            this._sendrecv?.sendMessage("#avatar-transform", new Uint8Array([
              // @ts-ignore
              ...floatToUInt8(headPos.x), ...floatToUInt8(headPos.y), ...floatToUInt8(headPos.z),
              // @ts-ignore
              radToUInt8(headRot.x), radToUInt8(headRot.y), radToUInt8(headRot.z),
              // @ts-ignore
              ...floatToUInt8(leftHandPos.x), ...floatToUInt8(leftHandPos.y), ...floatToUInt8(leftHandPos.z),
              // @ts-ignore
              radToUInt8(leftHandRot.x), radToUInt8(leftHandRot.y), radToUInt8(leftHandRot.z),
              // @ts-ignore
              ...floatToUInt8(rightHandPos.x), ...floatToUInt8(rightHandPos.y), ...floatToUInt8(rightHandPos.z),
              // @ts-ignore
              radToUInt8(rightHandRot.x), radToUInt8(rightHandRot.y), radToUInt8(rightHandRot.z),
              ...clientIdUInt8
            ]));
          }
        }
      }
      setInterval(syncAvatarTransform, 50);
    });
    this._sendrecv.on("message", event => {
      if (event.label === "#avatar-transform") {
        const t = new Uint8Array(event.data);
        const remoteAvatarEl = this._remoteAvatarEls.get(new TextDecoder().decode(t.subarray(27)));
        remoteAvatarEl?.head?.object3D?.position.set(uInt8ToFloat(t[0], t[1]), uInt8ToFloat(t[2], t[3]), uInt8ToFloat(t[4], t[5]));
        remoteAvatarEl?.head?.object3D.rotation.set(uInt8ToRad(t[6]), uInt8ToRad(t[7]), uInt8ToRad(t[8]));
        remoteAvatarEl?.leftHand?.object3D.position.set(uInt8ToFloat(t[9], t[10]), uInt8ToFloat(t[11], t[12]), uInt8ToFloat(t[13], t[14]));
        remoteAvatarEl?.leftHand?.object3D.rotation.set(uInt8ToRad(t[15]), uInt8ToRad(t[16]), uInt8ToRad(t[17]));
        remoteAvatarEl?.rightHand?.object3D.position.set(uInt8ToFloat(t[18], t[19]), uInt8ToFloat(t[20], t[21]), uInt8ToFloat(t[22], t[23]));
        remoteAvatarEl?.rightHand?.object3D.rotation.set(uInt8ToRad(t[24]), uInt8ToRad(t[25]), uInt8ToRad(t[26]));
      }
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
