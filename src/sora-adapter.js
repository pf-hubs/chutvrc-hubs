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
    this._recvStream = null;
  }

  async connect() {
    const channelId = "hao-sora-test@YHhaoareyou#43674499";
    const debug = false;
    let connection = [
      "wss://0006.canary.sora-labo.shiguredo.app/signaling",
      "wss://0004.canary.sora-labo.shiguredo.app/signaling",
      "wss://0003.canary.sora-labo.shiguredo.app/signaling"
    ];
    connection = "wss://0001.stable.sora-labo.shiguredo.app/signaling";
    const sora = Sora.connection(connection, debug);
    const metadata = {
      access_token:
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJjaGFubmVsX2lkIjoiaGFvLXNvcmEtdGVzdEBZSGhhb2FyZXlvdSM0MzY3NDQ5OSJ9.TVjTnSvOOk6e7zcRZDHtf-E9FLFAhWqvhRzjECfVh84"
    };
    const options = {
      audio: true,
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
    await this._sendrecv.connect(mediaStream);
    this.emit(SORA_CONNECTION_CONNECTED);
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
    if (this.isMicEnabled) {
      this.enableMicrophone(false);
    } else {
      this.enableMicrophone(true);
    }
  }

  enableMicrophone(enabled) {
    if (enabled && !this.isMicEnabled) {
      console.log("Enable mic");
    } else if (!enabled && this.isMicEnabled) {
      console.log("Disable mic");
    }
    this._micShouldBeEnabled = enabled;
    this.emit("mic-state-changed", { enabled: this.isMicEnabled });
  }

  get isMicEnabled() {
    return true;
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
