import { SFU_CONNECTION_TYPE } from "../sfu-types";
import { DataChannelMessage } from "../types/sfu-adapter-interface";
import type { SfuAdapter } from "./sfu-adapter";

// ========== Channel table ==========

export type ChannelKind = "text" | "binary";

/**
 * How Sora declares a channel's direction for a connection type:
 * - "byConnection": sendonly, recvonly or sendrecv following the connection type
 * - "sendrecv": sendrecv on every connection type
 * - "sendOrRecv": sendonly on a send-only connection, recvonly otherwise
 * - "sendrecvOnly": declared only on a send-and-receive connection, as sendrecv
 */
export type SoraDirectionRule = "byConnection" | "sendrecv" | "sendOrRecv" | "sendrecvOnly";

export type SoraDataChannelDirection = "sendonly" | "recvonly" | "sendrecv";

export interface ChannelSpec {
  readonly label: string;
  readonly kind: ChannelKind;
  /** Whether the channel should retransmit lost messages. Only LiveKit honours this today. */
  readonly reliable: boolean;
  /** Whether the channel should deliver messages in order. Only LiveKit honours this today. */
  readonly ordered: boolean;
  readonly sora: SoraDirectionRule;
  /** Whether the raw message is recorded. Avatar transforms are recorded decoded by the avatar sync helper. */
  readonly recordRaw: boolean;
}

/**
 * Every data channel the client uses, in the order the adapters open them.
 */
export const CHANNEL_TABLE: readonly ChannelSpec[] = [
  { label: "#avatarId", kind: "text", reliable: true, ordered: true, sora: "byConnection", recordRaw: true },
  { label: "#isVR", kind: "text", reliable: true, ordered: true, sora: "byConnection", recordRaw: true },
  { label: "#avatarAnimState", kind: "text", reliable: true, ordered: true, sora: "byConnection", recordRaw: true },
  { label: "#avatar-RIG", kind: "binary", reliable: false, ordered: false, sora: "byConnection", recordRaw: false },
  { label: "#avatar-HEAD", kind: "binary", reliable: false, ordered: false, sora: "byConnection", recordRaw: false },
  { label: "#avatar-LEFT", kind: "binary", reliable: false, ordered: false, sora: "byConnection", recordRaw: false },
  { label: "#avatar-RIGHT", kind: "binary", reliable: false, ordered: false, sora: "byConnection", recordRaw: false },
  { label: "#nimpro", kind: "text", reliable: true, ordered: true, sora: "sendrecv", recordRaw: true },
  { label: "#iot", kind: "binary", reliable: true, ordered: true, sora: "sendrecv", recordRaw: true },
  { label: "#pdfPage", kind: "text", reliable: true, ordered: true, sora: "sendOrRecv", recordRaw: true },
  { label: "#laserPointer", kind: "text", reliable: true, ordered: true, sora: "sendrecv", recordRaw: true },
  { label: "#emoji", kind: "text", reliable: true, ordered: true, sora: "sendrecv", recordRaw: true },
  { label: "#togglePublicSpeaker", kind: "text", reliable: true, ordered: true, sora: "sendrecvOnly", recordRaw: true }
];

const CHANNEL_SPECS_BY_LABEL = new Map(CHANNEL_TABLE.map(spec => [spec.label, spec]));

/** Labels of the four avatar transform channels (#avatar-RIG, #avatar-HEAD, #avatar-LEFT, #avatar-RIGHT). */
export function avatarTransformChannelLabels(): string[] {
  return CHANNEL_TABLE.filter(spec => spec.label.startsWith("#avatar-")).map(spec => spec.label);
}

/** Labels of every channel, in the order Dialog creates its DataProducers and LiveKit marks its channels ready. */
export function dataChannelLabels(): string[] {
  return CHANNEL_TABLE.map(spec => spec.label);
}

/** The spec for a label; a label outside the table is treated as a reliable, ordered text channel. */
export function channelSpec(label: string): ChannelSpec {
  return (
    CHANNEL_SPECS_BY_LABEL.get(label) ?? {
      label,
      kind: "text",
      reliable: true,
      ordered: true,
      sora: "sendrecv",
      recordRaw: true
    }
  );
}

function soraDirection(rule: SoraDirectionRule, connectionType: SFU_CONNECTION_TYPE): SoraDataChannelDirection | null {
  switch (rule) {
    case "byConnection":
      return connectionType === SFU_CONNECTION_TYPE.RECV
        ? "recvonly"
        : connectionType === SFU_CONNECTION_TYPE.SEND
        ? "sendonly"
        : "sendrecv";
    case "sendrecv":
      return "sendrecv";
    case "sendOrRecv":
      return connectionType === SFU_CONNECTION_TYPE.SEND ? "sendonly" : "recvonly";
    case "sendrecvOnly":
      return connectionType === SFU_CONNECTION_TYPE.SENDRECV ? "sendrecv" : null;
  }
}

/** The `dataChannels` option Sora is connected with for a connection type. */
export function soraDataChannels(
  connectionType: SFU_CONNECTION_TYPE
): { label: string; direction: SoraDataChannelDirection }[] {
  const channels: { label: string; direction: SoraDataChannelDirection }[] = [];
  for (const spec of CHANNEL_TABLE) {
    const direction = soraDirection(spec.sora, connectionType);
    if (direction) channels.push({ label: spec.label, direction });
  }
  return channels;
}

// ========== Recording ==========

type Vector3 = { x: number; y: number; z: number };
type RecordedDataChannelAvatarTransform = { c: string; p: Vector3; r: Vector3 };
export type RecordedDataChannelMessage = {
  l: string;
  m: string | RecordedDataChannelAvatarTransform | null;
  t: number;
  s: 0 | 1;
}; // l: label/channel, m: message, t: timestamp, s: isSend (0: false (is recv), 1: true)

// ========== Bus ==========

/** The adapter-specific parts of the bus, bound by the base adapter. */
export interface DataChannelDriver {
  /** Hands the encoded bytes to the SFU SDK. */
  send(label: string, data: Uint8Array, spec: ChannelSpec): void;
  /** Hands a received message to the channel handlers. */
  dispatch(label: string, data: ArrayBuffer): void;
}

const RELAY_QUEUE_CAP = 100;

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    ? (data.buffer as ArrayBuffer)
    : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
}

/**
 * The part of data channel handling that is the same for every SFU: the channel table, the send path,
 * the recording of sent and received messages, and the queue the public speaking relay drains.
 * Receive-side dispatch stays with the channel handlers under utils/data-channel-handlers.
 */
export class DataChannelBus {
  private readonly adapter: SfuAdapter;
  private readonly driver: DataChannelDriver;
  private readonly textEncoder = new TextEncoder();
  private readonly textDecoder = new TextDecoder();
  private recording = false;
  private recorded: RecordedDataChannelMessage[] = [];
  private relayQueue: DataChannelMessage[] = [];

  constructor(adapter: SfuAdapter, driver: DataChannelDriver) {
    this.adapter = adapter;
    this.driver = driver;
  }

  /** Sends on a channel. A receive-only adapter sends nothing. */
  send(label: string, data: string | Uint8Array): void {
    if (this.adapter._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    const spec = channelSpec(label);
    const isBytes = data instanceof Uint8Array;
    const bytes = isBytes ? data : this.textEncoder.encode(data);
    if (this.recording && spec.recordRaw) {
      this.record({ l: label, m: isBytes ? this.textDecoder.decode(data) : data, t: Date.now(), s: 1 });
    }
    try {
      this.driver.send(label, bytes, spec);
    } catch (error) {
      console.error(error);
    }
  }

  /** Takes a message received on a channel: records it, queues it for relay, then dispatches it. */
  receive(label: string, data: Uint8Array): void {
    const buffer = toArrayBuffer(data);
    if (this.recording && channelSpec(label).recordRaw) {
      this.record({ l: label, m: this.textDecoder.decode(data), t: Date.now(), s: 0 });
    }
    // The public speaking mirror keeps what it receives so the agents can relay it to the audience rooms
    if (this.adapter._roomId.includes("public_speaking") && this.adapter._connectionType === SFU_CONNECTION_TYPE.RECV) {
      this.relayQueue.push({ channelLabel: label, message: buffer });
      while (this.relayQueue.length > RELAY_QUEUE_CAP) {
        this.relayQueue.shift();
      }
    }
    this.driver.dispatch(label, buffer);
  }

  // ----- Recording -----

  get isRecording(): boolean {
    return this.recording;
  }

  startRecording(): void {
    this.recording = true;
  }

  stopRecording(): void {
    this.recording = false;
  }

  /** Adds an entry while recording; other code records what it decodes itself. */
  record(entry: RecordedDataChannelMessage): void {
    if (!this.recording) return;
    this.recorded.push(entry);
  }

  /** Returns what has been recorded and clears it. */
  takeRecording(): RecordedDataChannelMessage[] {
    const recorded = this.recorded;
    this.recorded = [];
    return recorded;
  }

  // ----- Relay -----

  /** The oldest message queued for relay, if any. */
  dequeueRelay(): DataChannelMessage | undefined {
    return this.relayQueue.shift();
  }
}
