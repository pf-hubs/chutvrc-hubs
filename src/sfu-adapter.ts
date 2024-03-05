import EventEmitter from "eventemitter3";
import { AvatarSyncHelper } from "./utils/avatar-sync-helper";

export const SFU_CONNECTION_CONNECTED = "sfu-connection-connected";
export const SFU_CONNECTION_ERROR_FATAL = "sfu-connection-error-fatal";

export abstract class SfuAdapter extends EventEmitter {
  _clientId: string;
  _avatarSyncHelper: AvatarSyncHelper;
  connect(props: any) {}
  disconnect() {}
  getMediaStream(clientId: string, kind: string) {}
  getLocalMicTrack() {}
  getLocalMediaStream() {}
  setLocalMediaStream(stream: MediaStream, videoContentHintByTrackId?: Map<string, string> | null) {}
  toggleMicrophone() {}
  enableMicrophone(enabled: boolean) {}
  get isMicEnabled(): boolean | null {
    return false;
  }
  async enableCamera(track: MediaStreamTrack) {}
  async disableCamera() {}
  async enableShare(track: MediaStreamTrack) {}
  async disableShare() {}
  kick(clientId: string) {}
  block(clientId: string) {}
  unblock(clientId: string) {}
  broadcast(channel: string, message: string) {}
  broadcastUint8(channel: string, message: Uint8Array) {}
  emitRTCEvent(level: string, tag: string, msgFunc: () => void) {}
}
