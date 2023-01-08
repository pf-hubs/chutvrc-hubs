import Sora from "sora-js-sdk";
import EventEmitter from "eventemitter3";
// import { MediaDevices } from "./utils/media-devices-utils";

export const SORA_CONNECTION_CONNECTED = "sora-connection-connected";
export const SORA_CONNECTION_ERROR_FATAL = "sora-connection-error-fatal";

export class SoraAdapter extends EventEmitter {
  constructor() {
    super();
    this._sendrecv = null;
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
      console.log("Track added: " + stream);
      if (!stream) return;
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
  }

  getMediaStream() {
    if (this._sendrecv) return this._sendrecv.stream;
  }
}
