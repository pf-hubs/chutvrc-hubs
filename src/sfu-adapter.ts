import EventEmitter from "eventemitter3";

export const SFU_CONNECTION_CONNECTED = "sfu-connection-connected";
export const SFU_CONNECTION_ERROR_FATAL = "sfu-connection-error-fatal";

export abstract class SfuAdapter extends EventEmitter {
  _clientId: string;
  connect(props: any) { }
  disconnect() { }
  getMediaStream(clientId: string, kind: string) { }
  getLocalMicTrack() { }
  getLocalMediaStream() { }
  setLocalMediaStream(stream: MediaStream, videoContentHintByTrackId?: Map<string, string> | null) { }
  toggleMicrophone() { }
  enableMicrophone(enabled: boolean) { }
  get isMicEnabled(): boolean | null { return false; }
  async enableCamera(track: MediaStreamTrack) {}
  async disableCamera() {}
  async enableShare(track: MediaStreamTrack) {}
  async disableShare() {}
  kick(clientId: string) { }
  block(clientId: string) { }
  unblock(clientId: string) { }
  emitRTCEvent(level: string, tag: string, msgFunc: () => void) { }
}