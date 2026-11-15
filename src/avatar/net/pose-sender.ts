import { SfuAdapter } from "../../sfu-adapters/sfu-adapter";
import { RecordedDataChannelAvatarPose } from "../../sfu-adapters/data-channel-bus";
import { LocalPoseSource } from "../pose/local-pose-source";
import { PoseStore } from "../pose/pose-store";
import { TrackedPart } from "../pose/tracked-pose";
import { BODY_BYTES, BodyPose, encodeBody, POSE_CHANNEL } from "./pose-codec-v1";

/** Shortest time between two frame-driven sends: at most 45 a second */
export const SEND_INTERVAL_MS = 22;

const round = (value: number) => Math.round(value * 1000) / 1000;
const textEncoder = new TextEncoder();

/** The senders that are started; the frame loop ticks them all, whichever session each belongs to */
const runningSenders = new Set<PoseSender>();

/**
 * The sequence number of the next packet, shared by every sender of the page. A page has one identity
 * on the wire, and a sender that is replaced on a reconnect carries the count on, so a receiver that
 * kept the client's pose does not take the new sender's first packets for late ones.
 */
let nextSeq = 0;

/** Called once a frame with the frame's time: gives every started sender the chance to send */
export function tickPoseSenders(now: number) {
  runningSenders.forEach(sender => sender.tick(now));
}

/**
 * Sends the own pose over the #avatar-pose channel, the whole body in one packet, driven by the frame
 * loop. Every tick that passes the rate gate sends, whether the body moved or not: the packet is small,
 * the channel loses packets, and a receiver blends between the packets it gets. The sender also samples
 * the pose it sends, so each session that sends (the room's under the own client id, a public speaking
 * sender under its own) keeps its own entry of the store current.
 */
export class PoseSender {
  private clientId = "";
  private encodedClientId: Uint8Array | undefined;
  private packet: Uint8Array | undefined;
  private lastSentAt = -Infinity;
  /** Reads the own rig, head and hands into the pose this sender sends; set once the rig is in the scene */
  source: LocalPoseSource | undefined;

  constructor(private readonly sfu: SfuAdapter, private readonly store: PoseStore) {}

  /** The client whose pose is read from the store and sent, known on every connect; the packet is sized for its id */
  setClientId(clientId: string) {
    this.clientId = clientId;
    this.encodedClientId = textEncoder.encode(clientId);
    this.packet = new Uint8Array(BODY_BYTES + this.encodedClientId.length);
  }

  /** From the next frame on, the pose is sent at most every SEND_INTERVAL_MS */
  start() {
    runningSenders.add(this);
  }

  stop() {
    runningSenders.delete(this);
    this.lastSentAt = -Infinity;
  }

  /** Whether the frame loop ticks this sender */
  get isRunning(): boolean {
    return runningSenders.has(this);
  }

  /** Samples the own pose, and sends when at least SEND_INTERVAL_MS have passed since the last frame-driven send */
  tick(now: number) {
    // Every frame, not only when sending: the own avatar is solved from this frame's devices
    this.source?.sample(now);
    if (now - this.lastSentAt < SEND_INTERVAL_MS) return;
    this.lastSentAt = now;
    this.send();
  }

  /** Sends the pose now, outside the frame gate: for a client that has not seen this avatar yet */
  sendAll() {
    this.send();
  }

  private send() {
    const { packet, encodedClientId } = this;
    const pose = this.store.get(this.clientId);
    // Nothing to send before the client id is known and the local sampler has written the pose once
    if (!packet || !encodedClientId || !pose || pose.receivedAt === 0) return;
    const seq = nextSeq;
    nextSeq = (nextSeq + 1) & 0xffff;
    const timeMs = performance.now() & 0xffff;
    encodeBody(pose, seq, timeMs, encodedClientId, packet);
    this.sfu.broadcastUint8(POSE_CHANNEL, packet);
    if (this.sfu.bus.isRecording) {
      this.sfu.bus.record({
        l: POSE_CHANNEL,
        m: recordedBody(this.clientId, pose, seq, timeMs),
        t: Date.now(),
        s: 1
      });
    }
  }
}

/** The decoded entry of a whole-body packet for the recording, as the sender and the receiver both record it */
export function recordedBody(
  clientId: string,
  body: BodyPose,
  seq: number,
  timeMs: number
): RecordedDataChannelAvatarPose {
  return {
    c: clientId,
    seq,
    t: timeMs,
    tracked: body.tracked,
    isVR: body.isVR,
    animState: body.animState,
    rig: recordedPart(body.rig),
    head: recordedPart(body.head),
    left: recordedPart(body.leftHand),
    right: recordedPart(body.rightHand)
  };
}

function recordedPart(part: Readonly<TrackedPart>) {
  return {
    p: { x: round(part.pos.x), y: round(part.pos.y), z: round(part.pos.z) },
    r: { x: round(part.rot.x), y: round(part.rot.y), z: round(part.rot.z) }
  };
}
