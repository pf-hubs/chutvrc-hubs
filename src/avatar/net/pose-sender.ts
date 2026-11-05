import { Object3D } from "three";
import { SfuAdapter } from "../../sfu-adapters/sfu-adapter";
import { AvatarPart, avatarPartTypes, AvatarTransformBuffer } from "../../utils/avatar-transform-buffer";

/** Shortest time between two frame-driven sends: at most 45 a second */
export const SEND_INTERVAL_MS = 22;

const round = (value: number) => Math.round(value * 1000) / 1000;

/** The senders that are started; the frame loop ticks them all, whichever session each belongs to */
const runningSenders = new Set<PoseSender>();

/** Called once a frame with the frame's time: gives every started sender the chance to send */
export function tickPoseSenders(now: number) {
  runningSenders.forEach(sender => sender.tick(now));
}

/**
 * Sends the own pose over the #avatar-RIG, #avatar-HEAD, #avatar-LEFT and #avatar-RIGHT channels, one
 * packet a part, driven by the frame loop instead of a timer. The packet of a part is the buffer's
 * encoding of the part's live object, so the bytes are the ones the timer sender sent.
 */
export class PoseSender {
  private buffer: AvatarTransformBuffer | undefined;
  private lastSentAt = -Infinity;

  constructor(private readonly sfu: SfuAdapter) {}

  /** The buffer that encodes the own pose; the adapter makes a new one on every connect */
  setBuffer(buffer: AvatarTransformBuffer | undefined) {
    this.buffer = buffer;
  }

  /** From the next frame in which a buffer exists on, the changed parts are sent at most every SEND_INTERVAL_MS */
  start() {
    runningSenders.add(this);
  }

  stop() {
    runningSenders.delete(this);
    this.lastSentAt = -Infinity;
  }

  /** Sends the changed parts when at least SEND_INTERVAL_MS have passed since the last frame-driven send */
  tick(now: number) {
    if (!this.buffer) return;
    if (now - this.lastSentAt < SEND_INTERVAL_MS) return;
    this.lastSentAt = now;
    this.send(true);
  }

  /** Sends the rig, and the parts that moved past the thresholds since their last send */
  sendChanged() {
    this.send(true);
  }

  /** Sends every part whether it moved or not, for a client that has not seen this avatar yet */
  sendAll() {
    this.send(false);
  }

  private send(onlyChanged: boolean) {
    const buffer = this.buffer;
    if (!buffer) return;
    for (const part of avatarPartTypes) {
      // RIG: always sync because rotation by pressing Q or E is only executed once, and sync can fail if there is loss in dataChannel:
      if (onlyChanged && part !== AvatarPart.RIG && !buffer.isUpdateAvatarTransformUpdated(part)) continue;

      const arrToSend = buffer.getEncodedAvatarTransform(part);
      this.sfu.broadcastUint8("#avatar-" + AvatarPart[part], arrToSend);
      buffer.markAvatarTransformSent(part);

      if (this.sfu.bus.isRecording) this.record(part, buffer.getAvatarObject(part));
    }
  }

  private record(part: AvatarPart, obj: Object3D) {
    this.sfu.bus.record({
      l: "#avatar-" + AvatarPart[part],
      m: {
        c: this.sfu.clientId,
        p: { x: round(obj.position.x), y: round(obj.position.y), z: round(obj.position.z) },
        r: { x: round(obj.rotation.x), y: round(obj.rotation.y), z: round(obj.rotation.z) }
      },
      t: Date.now(),
      s: 1
    });
  }
}
