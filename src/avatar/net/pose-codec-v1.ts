/**
 * Pose codec v1: the wire format of the #avatar-pose channel. One packet carries the whole body of one
 * client, the rig, the head and both hands, with the flags the body is solved with, a sequence number
 * and the sender's clock, so the channel can be unordered and unreliable and a receiver can drop a packet
 * that arrives after a newer one. Little-endian throughout:
 *
 *   byte   0      version          u8, 1
 *   byte   1      flags            u8: bit 0 head tracked, bit 1 left hand tracked, bit 2 right hand
 *                                  tracked, bit 3 in VR, bits 4-5 animation state
 *   bytes  2.. 3  seq              u16, counts the sender's packets and wraps
 *   bytes  4.. 5  senderTimeMs     u16, the sender's clock in milliseconds modulo 65536; informational
 *   bytes  6..17  rig position     Float32 × 3, metres, in the scene
 *   bytes 18..19  rig yaw          i16, radians × 32767 / π; the rig never pitches or rolls
 *   bytes 20..25  head position    i16 × 3, millimetres, relative to the rig, clamped to ±32.767 m
 *   bytes 26..31  left hand position
 *   bytes 32..37  right hand position
 *   bytes 38..41  head rotation    u32, smallest-three quaternion: bits 30-31 the index (x, y, z, w) of
 *                                  the component with the largest magnitude, which is left out after the
 *                                  quaternion is negated if needed to make it positive; bits 20-29, 10-19
 *                                  and 0-9 the other three in order, each a 10-bit two's complement of
 *                                  the component × √2 × 511
 *   bytes 42..45  left hand rotation
 *   bytes 46..49  right hand rotation
 *   bytes 50..    the sender's client id, UTF-8, up to the end of the packet
 *
 * The client id stays in the packet because the public speaking relay re-broadcasts the bytes under the
 * relay agent's identity and Sora reports no sender. The head and hand positions are relative to the rig
 * because that is how the pose has them: the pov node and the controllers are children of the rig.
 *
 * Neither direction allocates per call: the fixed part passes through one module-level scratch view, the
 * decoded header is one shared object overwritten by every decode, and the client id is cut out with
 * subarray and decoded by one shared TextDecoder.
 */

import { Position, Rotation } from "../../types/transform";
import { eulerToQuat, Quat, quatToEuler, TrackedPart } from "../pose/tracked-pose";

/** The channel the packets go over */
export const POSE_CHANNEL = "#avatar-pose";
export const POSE_VERSION = 1;
/** Number of bytes before the client id */
export const BODY_BYTES = 50;

const FLAG_TRACKED_MASK = 0x07;
const FLAG_IS_VR = 0x08;
const FLAG_ANIM_STATE_SHIFT = 4;
const FLAG_ANIM_STATE_MASK = 0x03;

const YAW_SCALE = 32767 / Math.PI;
const MM_PER_M = 1000;
/** A quaternion component other than the largest lies within ±1/√2; this maps that range onto ±511 */
const COMPONENT_SCALE = Math.SQRT2 * 511;

/** The four parts a packet carries, as the fields of a TrackedPose that hold them */
export type BodyParts = {
  rig: TrackedPart;
  head: TrackedPart;
  leftHand: TrackedPart;
  rightHand: TrackedPart;
};

/** What encodeBody reads: the parts and the flags; a TrackedPose is one */
export type BodyPose = Readonly<BodyParts> & {
  readonly tracked: number;
  readonly isVR: boolean;
  readonly animState: number;
};

/** The fixed part of a packet, decoded; the flags both raw and taken apart */
export type DecodedBodyHeader = {
  clientId: string;
  seq: number;
  timeMs: number;
  flags: number;
  tracked: number;
  isVR: boolean;
  animState: number;
};

const scratch = new ArrayBuffer(BODY_BYTES);
const scratchView = new DataView(scratch);
const scratchBytes = new Uint8Array(scratch);
const textDecoder = new TextDecoder();
const header: DecodedBodyHeader = { clientId: "", seq: 0, timeMs: 0, flags: 0, tracked: 0, isVR: false, animState: 0 };

/**
 * Writes the body followed by the encoded client id into `out`, which the caller sizes once as
 * `BODY_BYTES + encodedClientId.length`, and returns the number of bytes written. `seq` and `timeMs` are
 * taken modulo 65536.
 */
export function encodeBody(
  pose: BodyPose,
  seq: number,
  timeMs: number,
  encodedClientId: Uint8Array,
  out: Uint8Array
): number {
  const view = scratchView;
  view.setUint8(0, POSE_VERSION);
  view.setUint8(
    1,
    (pose.tracked & FLAG_TRACKED_MASK) |
      (pose.isVR ? FLAG_IS_VR : 0) |
      ((pose.animState & FLAG_ANIM_STATE_MASK) << FLAG_ANIM_STATE_SHIFT)
  );
  view.setUint16(2, seq & 0xffff, true);
  view.setUint16(4, timeMs & 0xffff, true);
  view.setFloat32(6, pose.rig.pos.x, true);
  view.setFloat32(10, pose.rig.pos.y, true);
  view.setFloat32(14, pose.rig.pos.z, true);
  view.setInt16(18, encodeYaw(pose.rig.rot.y), true);
  writeMillimetres(20, pose.head.pos);
  writeMillimetres(26, pose.leftHand.pos);
  writeMillimetres(32, pose.rightHand.pos);
  view.setUint32(38, packQuat(pose.head.quat), true);
  view.setUint32(42, packQuat(pose.leftHand.quat), true);
  view.setUint32(46, packQuat(pose.rightHand.quat), true);
  out.set(scratchBytes, 0);
  out.set(encodedClientId, BODY_BYTES);
  return BODY_BYTES + encodedClientId.length;
}

/**
 * Reads the four parts into `out`, each as position, quaternion and the matching YXZ Euler angles (the rig
 * with pitch and roll 0), and returns the header. The header object is shared: the next decode overwrites
 * it, so a caller keeps what it needs before decoding again.
 */
export function decodeBody(bytes: Uint8Array, out: BodyParts): DecodedBodyHeader {
  if (bytes.length < BODY_BYTES) {
    throw new RangeError(`Pose packet of ${bytes.length} bytes is shorter than ${BODY_BYTES} bytes`);
  }
  for (let i = 0; i < BODY_BYTES; i++) {
    scratchBytes[i] = bytes[i];
  }
  const view = scratchView;
  const version = view.getUint8(0);
  if (version !== POSE_VERSION) {
    throw new RangeError(`Pose packet version ${version} is not ${POSE_VERSION}`);
  }
  const flags = view.getUint8(1);
  header.flags = flags;
  header.tracked = flags & FLAG_TRACKED_MASK;
  header.isVR = (flags & FLAG_IS_VR) !== 0;
  header.animState = (flags >> FLAG_ANIM_STATE_SHIFT) & FLAG_ANIM_STATE_MASK;
  header.seq = view.getUint16(2, true);
  header.timeMs = view.getUint16(4, true);

  const rig = out.rig;
  rig.pos.x = view.getFloat32(6, true);
  rig.pos.y = view.getFloat32(10, true);
  rig.pos.z = view.getFloat32(14, true);
  rig.rot.x = 0;
  rig.rot.y = view.getInt16(18, true) / YAW_SCALE;
  rig.rot.z = 0;
  eulerToQuat(rig.rot, rig.quat);
  readPart(20, 38, out.head);
  readPart(26, 42, out.leftHand);
  readPart(32, 46, out.rightHand);

  header.clientId = textDecoder.decode(bytes.subarray(BODY_BYTES));
  return header;
}

/**
 * Whether a packet numbered `seq` comes before the one numbered `last` on the 16-bit circle, or is the
 * same number again: the packet is late and would move the avatar back. Half a circle ahead counts as
 * newer.
 */
export function isOlderSeq(seq: number, last: number): boolean {
  const ahead = (seq - last) & 0xffff;
  return ahead === 0 || ahead > 0x8000;
}

function encodeYaw(radians: number): number {
  // Any angle; wrapped onto ±π first
  return Math.round(Math.atan2(Math.sin(radians), Math.cos(radians)) * YAW_SCALE);
}

function toMillimetres(metres: number): number {
  const mm = Math.round(metres * MM_PER_M);
  return mm > 32767 ? 32767 : mm < -32767 ? -32767 : mm;
}

function writeMillimetres(offset: number, pos: Readonly<Position>) {
  scratchView.setInt16(offset, toMillimetres(pos.x), true);
  scratchView.setInt16(offset + 2, toMillimetres(pos.y), true);
  scratchView.setInt16(offset + 4, toMillimetres(pos.z), true);
}

function readPart(posOffset: number, quatOffset: number, out: TrackedPart) {
  const view = scratchView;
  out.pos.x = view.getInt16(posOffset, true) / MM_PER_M;
  out.pos.y = view.getInt16(posOffset + 2, true) / MM_PER_M;
  out.pos.z = view.getInt16(posOffset + 4, true) / MM_PER_M;
  unpackQuat(view.getUint32(quatOffset, true), out.quat);
  quatToEuler(out.quat, out.rot);
}

/** A component other than the largest as a 10-bit two's complement number, clamped to ±511 */
function quantize(component: number): number {
  let q = Math.round(component * COMPONENT_SCALE);
  if (q > 511) q = 511;
  else if (q < -511) q = -511;
  return q & 0x3ff;
}

/** The identity rotation packed: w is the largest component and the other three are 0 */
const IDENTITY_BITS = (3 << 30) >>> 0;

function packQuat(quat: Readonly<Quat>): number {
  let { x, y, z, w } = quat;
  const length = Math.sqrt(x * x + y * y + z * z + w * w);
  if (length === 0) return IDENTITY_BITS;
  let largest = 3;
  let max = Math.abs(w);
  if (Math.abs(x) > max) {
    largest = 0;
    max = Math.abs(x);
  }
  if (Math.abs(y) > max) {
    largest = 1;
    max = Math.abs(y);
  }
  if (Math.abs(z) > max) {
    largest = 2;
    max = Math.abs(z);
  }
  // Normalised, and negated if the largest component is negative: q and -q are the same rotation
  const sign = (largest === 0 ? x : largest === 1 ? y : largest === 2 ? z : w) < 0 ? -1 : 1;
  const scale = sign / length;
  x *= scale;
  y *= scale;
  z *= scale;
  w *= scale;
  let a: number;
  let b: number;
  let c: number;
  if (largest === 0) {
    a = y;
    b = z;
    c = w;
  } else if (largest === 1) {
    a = x;
    b = z;
    c = w;
  } else if (largest === 2) {
    a = x;
    b = y;
    c = w;
  } else {
    a = x;
    b = y;
    c = z;
  }
  return ((largest << 30) | (quantize(a) << 20) | (quantize(b) << 10) | quantize(c)) >>> 0;
}

/** The 10 low bits of `bits` as a signed number */
function signExtend10(bits: number): number {
  return ((bits & 0x3ff) << 22) >> 22;
}

function unpackQuat(bits: number, out: Quat) {
  const largest = bits >>> 30;
  const a = signExtend10(bits >>> 20) / COMPONENT_SCALE;
  const b = signExtend10(bits >>> 10) / COMPONENT_SCALE;
  const c = signExtend10(bits) / COMPONENT_SCALE;
  const d = Math.sqrt(Math.max(0, 1 - a * a - b * b - c * c));
  if (largest === 0) {
    out.x = d;
    out.y = a;
    out.z = b;
    out.w = c;
  } else if (largest === 1) {
    out.x = a;
    out.y = d;
    out.z = b;
    out.w = c;
  } else if (largest === 2) {
    out.x = a;
    out.y = b;
    out.z = d;
    out.w = c;
  } else {
    out.x = a;
    out.y = b;
    out.z = c;
    out.w = d;
  }
}
