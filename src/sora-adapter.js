import Sora from "sora-js-sdk";
import { debug as newDebug } from "debug";
import EventEmitter from "eventemitter3";
// import { MediaDevices } from "./utils/media-devices-utils";

export const SORA_CONNECTION_CONNECTED = "sora-connection-connected";
export const SORA_CONNECTION_ERROR_FATAL = "sora-connection-error-fatal";

const debug = newDebug("naf-dialog-adapter:debug");

export class SoraAdapter extends EventEmitter {
  constructor() {
    super();
    this._sendrecv = null;
    this._sendStream = null;
    this._recvStream = null;
    this._micShouldBeEnabled = false;
  }

  async connect() {
    const channelId = "hao-sora-test@YHhaoareyou#43674499";
    const debug = false;
    const connection = "wss://0001.stable.sora-labo.shiguredo.app/signaling";
    const sora = Sora.connection(connection, debug);
    const metadata = {
      access_token:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjaGFubmVsX2lkIjoiaGFvLXNvcmEtdGVzdEBZSGhhb2FyZXlvdSM0MzY3NDQ5OSIsImV4cCI6MTY3MzMzMTY0NX0.E-PnwsbfGpd_oeqnd7DCEJ887lwselj2PpRBqqSe01w"
    };
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
      console.log("Track removed: " + event.target.id);
    });
    const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    this._sendrecv
      .connect(mediaStream)
      .then(stream => {
        this._sendStream = stream;
        this.emit(this._sendStream ? SORA_CONNECTION_CONNECTED : SORA_CONNECTION_ERROR_FATAL);
      })
      .catch(e => {
        console.error(e);
        this.emit(SORA_CONNECTION_ERROR_FATAL);
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

  enableMicrophone(enabled) {
    this._sendStream.getAudioTracks()[0].enabled = enabled;
    this._micShouldBeEnabled = enabled;
    this.emit("mic-state-changed", { enabled: this._micShouldBeEnabled });
  }

  get isMicEnabled() {
    return this._sendStream != null && this._micShouldBeEnabled;
  }

  async enableCamera() {}

  async disableCamera() {}

  async enableShare() {}

  async disableShare() {}

  kick(clientId) {
    // ...
    document.body.dispatchEvent(new CustomEvent("kicked", { detail: { clientId: clientId } }));
  }

  block(clientId) {
    // ...
    document.body.dispatchEvent(new CustomEvent("blocked", { detail: { clientId: clientId } }));
  }

  unblock(clientId) {
    // ...
    document.body.dispatchEvent(new CustomEvent("unblocked", { detail: { clientId: clientId } }));
  }

  emitRTCEvent(level, tag, msgFunc) {
    if (!window.APP.store.state.preferences.showRtcDebugPanel) return;
    const time = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "numeric",
      minute: "numeric",
      second: "numeric"
    });
    this.scene.emit("rtc_event", { level, tag, time, msg: msgFunc() });
  }
}
