import Sora, * as SoraType from "sora-js-sdk";
import { debug as newDebug } from "debug";
import { SFU_CONNECTION_CONNECTED, SFU_CONNECTION_ERROR_FATAL, SfuAdapter } from "./sfu-adapter";
import { MediaDevices } from "./utils/media-devices-utils";
import { floatToUInt8, uInt8ToFloat, degreeToUInt8, uInt8ToDegree } from "./utils/uint8-parser";

const debug = newDebug("naf-dialog-adapter:debug");

type ConnectProps = {
  clientId: string;
  channelId: string;
  signalingUrl: string;
  accessToken: string;
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
  _hmd: Element | null;
  _leftController: Element | null;
  _rightController: Element | null;

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
          label: "#hmd-transform",
          direction: "sendrecv" as SoraType.DataChannelDirection
        },
        {
          label: "#left-hand-transform",
          direction: "sendrecv" as SoraType.DataChannelDirection
        },
        {
          label: "#right-hand-transform",
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
          }
        });
        // clients entering this room later
        if (event.client_id && event.connection_id && !this._remoteMediaStreams.has(event.client_id)) {
          this._clientStreamIdPair.set(event.client_id, event.connection_id);
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
      let intervalId: NodeJS.Timer;
      const getPlayerAvatar = () => {
        this._hmd = document.querySelector("#avatar-pov-node");
        this._leftController = document.querySelector("#player-left-controller");
        this._rightController = document.querySelector("#player-right-controller");
        if (this._hmd && this._leftController && this._rightController) clearInterval(intervalId);
      }
      intervalId = setInterval(getPlayerAvatar, 1000);

      const syncHmd = async () => {
        if (this._hmd) {
          var pos = this._hmd?.getAttribute("position");
          var rot = this._hmd?.getAttribute("rotation");
          this._sendrecv?.sendMessage("#hmd-transform", new Uint8Array([
            // @ts-ignore
            ...floatToUInt8(pos.x), ...floatToUInt8(pos.y), ...floatToUInt8(pos.z), ...degreeToUInt8(rot.x), ...degreeToUInt8(rot.y), ...degreeToUInt8(rot.z)
          ]));
        }
      }
      const syncLeft = async () => {
        if (this._leftController) {
          var pos = this._leftController?.getAttribute("position");
          var rot = this._leftController?.getAttribute("rotation");
          this._sendrecv?.sendMessage("#left-hand-transform", new Uint8Array([
            // @ts-ignore
            ...floatToUInt8(pos.x), ...floatToUInt8(pos.y), ...floatToUInt8(pos.z), ...degreeToUInt8(rot.x), ...degreeToUInt8(rot.y), ...degreeToUInt8(rot.z)
          ]));
        }
      }
      const syncRight = async () => {
        if (this._rightController) {
          var pos = this._rightController?.getAttribute("position");
          var rot = this._rightController?.getAttribute("rotation");
          this._sendrecv?.sendMessage("#right-hand-transform", new Uint8Array([
            // @ts-ignore
            ...floatToUInt8(pos.x), ...floatToUInt8(pos.y), ...floatToUInt8(pos.z), ...degreeToUInt8(rot.x), ...degreeToUInt8(rot.y), ...degreeToUInt8(rot.z)
          ]));
        }
      }
      setInterval(syncHmd, 500);
      setInterval(syncLeft, 500);
      setInterval(syncRight, 500);
    });
    this._sendrecv.on("message", event => {
      if (["#hmd-transform", "#left-hand-transform", "#right-hand-transform"].includes(event.label)) {
        const transform = new Uint8Array(event.data);
        var pos = {
          // @ts-ignore
          x: uInt8ToFloat(transform[0], transform[1]),
          // @ts-ignore
          y: uInt8ToFloat(transform[2], transform[3]),
          // @ts-ignore
          z: uInt8ToFloat(transform[4], transform[5])
        };
        var rot = {
          // @ts-ignore
          x: uInt8ToDegree(transform[6], transform[7]),
          // @ts-ignore
          y: uInt8ToDegree(transform[8], transform[9]),
          // @ts-ignore
          z: uInt8ToDegree(transform[10], transform[11])
        };
        console.log(`${event.label} position x: ${pos.x}, y: ${pos.y}, z: ${pos.z}`);
        console.log(`${event.label} rotation x: ${rot.x}, y: ${rot.y}, z: ${rot.z}`);
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
