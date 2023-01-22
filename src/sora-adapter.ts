import Sora, * as SoraType from "sora-js-sdk";
import { debug as newDebug } from "debug";
import { SFU_CONNECTION_CONNECTED, SFU_CONNECTION_ERROR_FATAL, SfuAdapter } from "./sfu-adapter";
import { MediaDevices } from "./utils/media-devices-utils";

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
  _micShouldBeEnabled: boolean;
  _scene: Element | null;

  constructor() {
    super();
    this._clientId = "";
    this._sendrecv = null;
    this._localMediaStream = null;
    this._remoteMediaStreams = new Map<string, MediaStream | null>();
    this._clientStreamIdPair = new Map<string, string>();
    this._micShouldBeEnabled = false;
  }

  async connect({ clientId, channelId, signalingUrl, accessToken, debug }: ConnectProps) {
    const sora = Sora.connection(signalingUrl, debug);
    const metadata = { access_Token: accessToken };
    const options = {
      clientId: clientId,
      audio: true,
      multistream: true,
      video: true
    };

    this._clientId = clientId;
    this._sendrecv = sora.sendrecv(channelId, metadata, options);
    this._sendrecv.on("notify", event => {
      if (event.event_type === "connection.created") {
        if (event.client_id && event.connection_id && !this._remoteMediaStreams.has(event.client_id)){
          this._clientStreamIdPair.set(event.client_id, event.connection_id);
        }
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
      console.log("Track removed: " + event.target?.id);
    });
    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this._sendrecv
      .connect(mediaStream)
      .then(stream => {
        this._localMediaStream = stream;
        this.emit(this._localMediaStream ? SFU_CONNECTION_CONNECTED : SFU_CONNECTION_ERROR_FATAL);
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
      stream = this._localMediaStream;
    } else {
      const streamId = this._clientStreamIdPair.get(clientId);
      if (streamId) {
        stream = this._remoteMediaStreams.get(streamId);
      }
    }

    if (stream) {
      tracks = kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
      if (tracks) return new MediaStream(tracks);
    }

    return null;
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
            await this.disableCamera();
            await this.enableShare(track);
          } else if (contentHint === MediaDevices.CAMERA) {
            await this.disableShare();
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
    this._localMediaStream = stream;
  }

  toggleMicrophone() {
    if (this._micShouldBeEnabled) {
      this.enableMicrophone(false);
    } else {
      this.enableMicrophone(true);
    }
  }

  enableMicrophone(enabled: boolean) {
    if (this._localMediaStream){
      this._localMediaStream.getAudioTracks().forEach(track => track.kind === "audio" && (track.enabled = enabled));
      this._micShouldBeEnabled = enabled;
      this.emit("mic-state-changed", { enabled: this._micShouldBeEnabled });
    }
  }

  get isMicEnabled() {
    return this._localMediaStream != null && this._micShouldBeEnabled;
  }

  async enableCamera(track: MediaStreamTrack) {}

  async disableCamera() {}

  async enableShare(track: MediaStreamTrack) {}

  async disableShare() {}

  kick(clientId: string) {
    // ...
    document.body.dispatchEvent(new CustomEvent("kicked", { detail: { clientId: clientId } }));
  }

  block(clientId: string) {
    // ...
    document.body.dispatchEvent(new CustomEvent("blocked", { detail: { clientId: clientId } }));
  }

  unblock(clientId: string) {
    // ...
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
