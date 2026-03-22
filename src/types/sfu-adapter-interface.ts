import EventEmitter from "eventemitter3";
import { BridgeCapable } from "../libpeer/bridge/bridge-capable";
import { SFU, SFU_CONNECTION_TYPE } from "../sfu-types";

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
 * Connection lifecycle management
 */
export interface ISfuConnectable {
  connect(props: Record<string, unknown>): Promise<void> | void;
  disconnect(): Promise<void> | void;
  readonly clientId: string;
  readonly roomId: string;
}

/**
 * Media stream management for audio/video tracks
 */
export interface ISfuMediaStreams {
  getMediaStream(clientId: string, kind: string): Promise<MediaStream | null> | MediaStream | null | undefined;
  getLocalMicTrack(): MediaStreamTrack | undefined;
  getLocalMediaStream(): MediaStream | null | undefined;
  setLocalMediaStream(stream: MediaStream, videoContentHintByTrackId?: Map<string, string> | null): Promise<void> | void;
  enableCamera(track: MediaStreamTrack): Promise<void>;
  disableCamera(): Promise<void>;
  enableShare(track: MediaStreamTrack): Promise<void>;
  disableShare(): Promise<void>;
}

/**
 * Microphone-specific control
 */
export interface ISfuMicrophoneControl {
  enableMicrophone(enabled: boolean): void;
  toggleMicrophone(): void;
  readonly isMicEnabled: boolean | null;
}

/**
 * Data channel communication for avatar sync and other real-time data
 */
export interface ISfuDataChannels {
  getDataChannelMessage(): DataChannelMessage | undefined;
  broadcast(channel: string, message: string): void;
  broadcastUint8(channel: string, message: Uint8Array): void;
  setLocalDataChannelMessage(message: DataChannelMessage): void;
}

/**
 * Participant management (kick, block, unblock)
 */
export interface ISfuParticipantControl {
  kick(clientId: string): Promise<void> | void;
  block(clientId: string): Promise<void> | void;
  unblock(clientId: string): Promise<void> | void;
}

/**
 * RTC event diagnostics and logging
 */
export interface ISfuDiagnostics {
  emitRTCEvent(level: string, tag: string, msgFunc: () => string | void): void;
}

/**
 * Combined SFU adapter interface implementing all capabilities
 * Adapters should implement ISfuAdapter to be fully compatible
 */
export interface ISfuAdapter
  extends EventEmitter,
    ISfuConnectable,
    ISfuMediaStreams,
    ISfuMicrophoneControl,
    ISfuDataChannels,
    ISfuParticipantControl,
    ISfuDiagnostics,
    BridgeCapable {
  /**
   * SFU type identifier
   */
  readonly sfuId: SFU;

  /**
   * Connection type (sendrecv, send, recv)
   */
  readonly connectionType: SFU_CONNECTION_TYPE;
}
