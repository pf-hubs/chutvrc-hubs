import EventEmitter from "eventemitter3";
import { AvatarSyncHelper } from "./utils/avatar-sync-helper";
import { SFU, SFU_CONNECTION_TYPE } from "./sfu-types";

type DataChannelMessage = { channelLabel: string; message: ArrayBuffer | null };
type Vector3 = { x: number; y: number; z: number };
type RecordedDataChannelAvatarTransform = { c: string; p: Vector3; r: Vector3 };
type RecordedDataChannelMessage = {
  l: string;
  m: string | RecordedDataChannelAvatarTransform | null;
  t: number;
  s: 0 | 1;
}; // l: label/chanel, m: message, t: timestamp, s: isSend (0: false (is recv), 1: true)

export const SFU_CONNECTION_CONNECTED = "sfu-connection-connected";
export const SFU_CONNECTION_ERROR_FATAL = "sfu-connection-error-fatal";

export abstract class SfuAdapter extends EventEmitter {
  _sfuId: SFU;
  _clientId: string;
  _roomId: string;
  _avatarSyncHelper: AvatarSyncHelper;
  _connectionType: SFU_CONNECTION_TYPE;
  _dataChannelMessages: DataChannelMessage[];
  _recordedDataChannelMessages: RecordedDataChannelMessage[];
  _isRecording: boolean;
  _sendSelfAvatarSrcIntervalId: NodeJS.Timer;
  _publicSpeakerClientIdsInRoom: string[];
  connect(props: any) {}
  disconnect() {}
  getMediaStream(clientId: string, kind: string) {}
  getDataChannelMessage(): DataChannelMessage | undefined {
    return { channelLabel: "", message: null };
  }
  getLocalMicTrack(): MediaStreamTrack | undefined {
    return undefined;
  }
  getLocalMediaStream() {}
  setLocalMediaStream(stream: MediaStream, videoContentHintByTrackId?: Map<string, string> | null) {}
  setLocalDataChannelMessage(m: DataChannelMessage) {} // TODO: specify type
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
