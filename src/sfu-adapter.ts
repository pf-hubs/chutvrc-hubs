import EventEmitter from "eventemitter3";

export const SFU_CONNECTION_CONNECTED = "sfu-connection-connected";
export const SFU_CONNECTION_ERROR_FATAL = "sfu-connection-error-fatal";

export abstract class SfuAdapter extends EventEmitter {
  connect(props: any) { }
  disconnect() { }
  getMediaStream() { }
  toggleMicrophone() { }
  enableMicrophone(enabled: boolean) { }
  get isMicEnabled() { return false; }
  async enableCamera() {}
  async disableCamera() {}
  async enableShare() {}
  async disableShare() {}
  kick(clientId: string) { }
  block(clientId: string) { }
  unblock(clientId: string) { }
  emitRTCEvent(level: string, tag: string, msgFunc: () => void) { }
}