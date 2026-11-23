import EventEmitter from "eventemitter3";
import { BridgeCapable } from "../libpeer/bridge/bridge-capable";
import { SFU, SFU_CONNECTION_TYPE } from "../sfu-types";
import { SfuConfig } from "../sfu-adapters/sfu-config";

/**
 * Data channel message type for SFU communication
 */
export type DataChannelMessage = {
  channelLabel: string;
  message: ArrayBuffer | null;
};

/**
 * Connection state for SFU adapters
 */
export enum SfuConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  CONNECTED = "connected",
  RECONNECTING = "reconnecting",
  FAILED = "failed"
}

/**
 * What the rest of the client may use on a media server connection. The SfuSession behind
 * APP.sfu implements it, and so does the adapter inside the session.
 */
export interface ISfuAdapter extends EventEmitter, BridgeCapable {
  /** The media server kind, or null while the session has not connected to one */
  readonly sfuId: SFU | null;
  /** Connection type (sendrecv, send, recv) */
  readonly connectionType: SFU_CONNECTION_TYPE;
  readonly roomId: string;
  readonly config: SfuConfig | null;
  readonly isConnected: boolean;
  hubChannel: any;

  connect(config: SfuConfig): Promise<void>;
  disconnect(): Promise<void>;

  getMediaStream(clientId: string, kind?: string): Promise<MediaStream | null>;
  getLocalMicTrack(): MediaStreamTrack | undefined;
  getLocalMediaStream(): MediaStream | null | undefined;
  setLocalMediaStream(stream: MediaStream, videoContentHintByTrackId?: Map<string, string> | null): Promise<void>;
  enableMicrophone(enabled: boolean): void;
  toggleMicrophone(): void;
  readonly isMicEnabled: boolean | null;

  broadcast(channel: string, message: string): void;
  broadcastUint8(channel: string, message: Uint8Array): void;

  kick(clientId: string): Promise<void> | void;
  block(clientId: string): Promise<void> | void;
  unblock(clientId: string): Promise<void> | void;
}
