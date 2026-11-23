import { Euler, Quaternion } from "three";
import { Position, Rotation } from "../../types/transform";
import { Quat } from "../pose/tracked-pose";

/** The parts of a pose, named as the fields of a TrackedPose that hold them */
export const POSE_PARTS = ["rig", "head", "leftHand", "rightHand"] as const;
export type PosePart = (typeof POSE_PARTS)[number];

/** Samples kept per part: about a second of packets at the rate the body is sent */
export const CAPACITY = 32;
/** How far past the newest sample a part is carried on at its last velocity */
export const MAX_EXTRAPOLATION_MS = 100;
/** How long after that the part takes to come back to the newest sample, which it then holds */
export const EXTRAPOLATION_RETURN_MS = 100;
/**
 * The shortest spacing of the two samples a velocity is taken from. Samples are timed by arrival, not by
 * the sender's clock; two that arrived closer than this were most likely sent further apart and would
 * give a velocity far too high, so the velocity is taken over the next older sample.
 */
const MIN_VELOCITY_SPAN_MS = 25;

const scratchEuler = new Euler(0, 0, 0, "YXZ");
const quatFrom = new Quaternion();
const quatTo = new Quaternion();
const quatOut = new Quaternion();

/**
 * Writes a rotation as the quaternion and as the YXZ Euler angles the solvers read. The rotation is
 * the one the sender had; only the angle triple can differ from the sender's, at a pitch of ±90°, where
 * yaw and roll are not separable and the decomposition puts the whole turn into the yaw.
 */
function writeRotation(quat: Quaternion, outRot: Rotation, outQuat: Quat) {
  scratchEuler.setFromQuaternion(quat);
  outRot.x = scratchEuler.x;
  outRot.y = scratchEuler.y;
  outRot.z = scratchEuler.z;
  outQuat.x = quat.x;
  outQuat.y = quat.y;
  outQuat.z = quat.z;
  outQuat.w = quat.w;
}

/**
 * A fixed number of timestamped samples of one part in the order they were pushed, the newest replacing
 * the oldest once the ring is full. The slots are ranges of three typed arrays allocated once.
 */
class SampleRing {
  private readonly times = new Float64Array(CAPACITY);
  private readonly positions = new Float64Array(CAPACITY * 3);
  /** Quaternions as x, y, z, w */
  private readonly rotations = new Float64Array(CAPACITY * 4);
  private count = 0;
  /** The slot the newest sample is in, once there is one */
  private newest = CAPACITY - 1;

  push(time: number, pos: Readonly<Position>, quat: Readonly<Quat>) {
    // Arrival times never go backwards; should a caller's clock, the ring stays ordered by insertion
    if (this.count > 0 && time < this.times[this.newest]) time = this.times[this.newest];
    const slot = (this.newest + 1) % CAPACITY;
    this.times[slot] = time;
    const p = slot * 3;
    this.positions[p] = pos.x;
    this.positions[p + 1] = pos.y;
    this.positions[p + 2] = pos.z;
    const r = slot * 4;
    this.rotations[r] = quat.x;
    this.rotations[r + 1] = quat.y;
    this.rotations[r + 2] = quat.z;
    this.rotations[r + 3] = quat.w;
    this.newest = slot;
    if (this.count < CAPACITY) this.count++;
  }

  /** Writes the pose at `time` into the outputs; returns false and writes nothing while the ring is empty */
  sample(time: number, outPos: Position, outRot: Rotation, outQuat: Quat): boolean {
    if (this.count === 0) return false;
    // Walk back from the newest sample to the newest one at or before `time`
    let age = 0;
    while (age < this.count && this.times[this.slotAt(age)] > time) age++;
    if (age === 0) {
      this.extrapolate(time, outPos, outRot, outQuat);
    } else if (age === this.count) {
      // Older than every sample: hold the oldest
      this.write(this.slotAt(age - 1), outPos, outRot, outQuat);
    } else {
      const from = this.slotAt(age);
      const to = this.slotAt(age - 1);
      const t = (time - this.times[from]) / (this.times[to] - this.times[from]);
      this.blend(from, to, t, outPos, outRot, outQuat);
    }
    return true;
  }

  /** The slot of the sample pushed `age` pushes before the newest one */
  private slotAt(age: number): number {
    return (this.newest - age + CAPACITY) % CAPACITY;
  }

  /**
   * Past the newest sample: carries the part on at the velocity between the newest sample and an earlier
   * one for MAX_EXTRAPOLATION_MS, then eases it back to the newest sample over EXTRAPOLATION_RETURN_MS and
   * holds it there. Coming back matters because an old build sends a head or hand only while it moves:
   * for those, no newer packet usually means "still", and the newest sample is where the part is.
   */
  private extrapolate(time: number, outPos: Position, outRot: Rotation, outQuat: Quat) {
    const newest = this.slotAt(0);
    const newestTime = this.times[newest];
    let age = 1;
    while (age < this.count && newestTime - this.times[this.slotAt(age)] < MIN_VELOCITY_SPAN_MS) age++;
    const ahead = time - newestTime;
    if (age === this.count || ahead >= MAX_EXTRAPOLATION_MS + EXTRAPOLATION_RETURN_MS) {
      this.write(newest, outPos, outRot, outQuat);
      return;
    }
    const from = this.slotAt(age);
    const span = newestTime - this.times[from];
    const back = Math.max(0, ahead - MAX_EXTRAPOLATION_MS);
    const reach = Math.min(ahead, MAX_EXTRAPOLATION_MS) * (1 - back / EXTRAPOLATION_RETURN_MS);
    this.blend(from, newest, 1 + reach / span, outPos, outRot, outQuat);
  }

  /** Writes the pose a fraction `t` of the way from one slot to another; `t` above one carries on past the second */
  private blend(from: number, to: number, t: number, outPos: Position, outRot: Rotation, outQuat: Quat) {
    const p = this.positions;
    const a = from * 3;
    const b = to * 3;
    outPos.x = p[a] + (p[b] - p[a]) * t;
    outPos.y = p[a + 1] + (p[b + 1] - p[a + 1]) * t;
    outPos.z = p[a + 2] + (p[b + 2] - p[a + 2]) * t;
    const r = this.rotations;
    quatFrom.set(r[from * 4], r[from * 4 + 1], r[from * 4 + 2], r[from * 4 + 3]);
    quatTo.set(r[to * 4], r[to * 4 + 1], r[to * 4 + 2], r[to * 4 + 3]);
    writeRotation(quatOut.slerpQuaternions(quatFrom, quatTo, t), outRot, outQuat);
  }

  private write(slot: number, outPos: Position, outRot: Rotation, outQuat: Quat) {
    const p = slot * 3;
    outPos.x = this.positions[p];
    outPos.y = this.positions[p + 1];
    outPos.z = this.positions[p + 2];
    const r = this.rotations;
    const i = slot * 4;
    writeRotation(quatOut.set(r[i], r[i + 1], r[i + 2], r[i + 3]), outRot, outQuat);
  }
}

/**
 * The recent samples of one remote client's pose, a ring per part, and the pose at any moment between
 * them. Rotations are kept as quaternions so that two samples blend along the shortest arc, across the
 * ±180° yaw wrap too; a whole-body packet gives its quaternions directly, an old per-part packet its YXZ
 * Euler angles, and a sample comes out as both.
 *
 * Samples are ordered by arrival: the old per-part packets carry no sequence number, and a whole-body
 * packet that arrives after a newer one is dropped before it gets here, so a push is never older than the
 * previous one and a ring is read in insertion order. Nothing is allocated per packet or per frame.
 */
export class InterpolationBuffer {
  private readonly rings: Record<PosePart, SampleRing> = {
    rig: new SampleRing(),
    head: new SampleRing(),
    leftHand: new SampleRing(),
    rightHand: new SampleRing()
  };

  /**
   * Keeps the part's pose as received at `receivedAt`, on the clock the frame loop samples with. The
   * rotation is `quat` when given, otherwise the YXZ Euler angles.
   */
  push(
    part: PosePart,
    receivedAt: number,
    pos: Readonly<Position>,
    rotEuler: Readonly<Rotation>,
    quat?: Readonly<Quat>
  ) {
    if (!quat) {
      scratchEuler.set(rotEuler.x, rotEuler.y, rotEuler.z);
      quat = quatFrom.setFromEuler(scratchEuler);
    }
    this.rings[part].push(receivedAt, pos, quat);
  }

  /**
   * Writes the part's pose at `renderTime`: blended between the samples around it, carried on past the
   * newest one for a short while, or the only sample held. Returns false and writes nothing while the
   * part has no sample.
   */
  sample(part: PosePart, renderTime: number, outPos: Position, outRotEuler: Rotation, outQuat: Quat): boolean {
    return this.rings[part].sample(renderTime, outPos, outRotEuler, outQuat);
  }
}
