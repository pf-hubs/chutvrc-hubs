import Sora, * as SoraType from "sora-js-sdk";
import { debug as newDebug } from "debug";
import { SFU_CONNECTION_CONNECTED, SFU_CONNECTION_ERROR_FATAL, SfuAdapter } from "./sfu-adapter";
// import { MediaDevices } from "./utils/media-devices-utils";

const debug = newDebug("naf-dialog-adapter:debug");

type ConnectProps = {
  channelId: string;
  signalingUrl: string;
  accessToken: string;
  debug: boolean;
  options?: SoraType.ConnectionOptions;
}

export class SoraAdapter extends SfuAdapter {
  _sendrecv: SoraType.ConnectionPublisher | null;
  _sendStream: MediaStream | null;
  _recvStream: MediaStream | null;
  _micShouldBeEnabled: boolean;
  _scene: Element | null;

  constructor() {
    super();
    this._sendrecv = null;
    this._sendStream = null;
    this._recvStream = null;
    this._micShouldBeEnabled = false;
  }

  async connect({ channelId, signalingUrl, accessToken, debug }: ConnectProps) {
    const sora = Sora.connection(signalingUrl, debug);
    const metadata = { access_Token: accessToken };
    const options = {
      audio: true,
      multistream: true,
      video: false
    };

    this._sendrecv = sora.sendrecv(channelId, metadata, options);
    this._sendrecv.on("track", event => {
      const stream = event.streams[0];
      if (!stream) return;
      this._recvStream = stream;
    });
    this._sendrecv.on("removetrack", event => {
      // console.log("Track removed: " + event.target?.id);
      console.log("Track removed: " + event.target);
    });
    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this._sendrecv
      .connect(mediaStream)
      .then(stream => {
        this._sendStream = stream;
        this.emit(this._sendStream ? SFU_CONNECTION_CONNECTED : SFU_CONNECTION_ERROR_FATAL);
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

  getMediaStream() {
    if (this._recvStream) {
      return this._recvStream;
    } else if (this._sendrecv) {
      return this._sendrecv.stream;
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
    if (this._sendStream){
      this._sendStream.getAudioTracks()[0].enabled = enabled;
      this._micShouldBeEnabled = enabled;
      this.emit("mic-state-changed", { enabled: this._micShouldBeEnabled });
    }
  }

  get isMicEnabled() {
    return this._sendStream != null && this._micShouldBeEnabled;
  }

  async enableCamera() {}

  async disableCamera() {}

  async enableShare() {}

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
