import { Position, Rotation, Transform } from "../../types/transform";
import { AvatarAnimState } from "../../types/avatar-types";

type Xyz = { x: number; y: number; z: number };

/** A unit quaternion as plain fields, the shape three.js's Quaternion has too */
export type Quat = { x: number; y: number; z: number; w: number };

/** The bits of TrackedPose.tracked: which parts the sender's devices report a pose for */
export const TRACKED_HEAD = 1;
export const TRACKED_LEFT_HAND = 2;
export const TRACKED_RIGHT_HAND = 4;
export const TRACKED_ALL = TRACKED_HEAD | TRACKED_LEFT_HAND | TRACKED_RIGHT_HAND;

/**
 * One part of a pose: a position and the same rotation twice, as the YXZ Euler angles the old solver reads
 * and as a quaternion, which the whole-body packet and the interpolation buffer use. Every writer keeps the
 * two equal; only the angle triple can differ from the sender's, at a pitch of ±90°, where yaw and roll are
 * not separable and the decomposition puts the whole turn into the yaw.
 */
export type TrackedPart = {
  pos: Position;
  rot: Rotation;
  quat: Quat;
};

/**
 * The pose of one avatar as the solver reads it: the rig and the three tracked parts, each in the rig's
 * space, the way the headset and controllers report them.
 *
 * The four part objects are allocated once per avatar and updated in place, never replaced: the solver
 * keeps references to them, and a received packet, the local sampler and the chatbot all write into them.
 */
export type TrackedPose = {
  rig: TrackedPart;
  head: TrackedPart;
  leftHand: TrackedPart;
  rightHand: TrackedPart;
  /** TRACKED_* bits of the parts the sender's devices track; a part that is not tracked holds its last pose */
  tracked: number;
  /** Whether the client's headset is presenting; the solver moves the hands from the controllers only then */
  isVR: boolean;
  animState: AvatarAnimState;
  /** A pose written by the chatbot rather than received from a client; solved only on the frames it is written */
  isNPC: boolean;
  /** performance.now() of the last write to any part; 0 until the first write */
  receivedAt: number;
  /** The sequence number of the last whole-body packet taken from the client; -1 until the first */
  seq: number;
  /** The sender's clock in milliseconds modulo 65536 at that packet; informational */
  senderTimeMs: number;
};

const zeroPart = (): TrackedPart => ({
  pos: { x: 0, y: 0, z: 0 },
  rot: { x: 0, y: 0, z: 0 },
  quat: { x: 0, y: 0, z: 0, w: 1 }
});

/** A pose at the origin, not in VR and standing: what the solver assumed before a client's first packet */
export function createTrackedPose(isNPC = false): TrackedPose {
  return {
    rig: zeroPart(),
    head: zeroPart(),
    leftHand: zeroPart(),
    rightHand: zeroPart(),
    tracked: 0,
    isVR: false,
    animState: AvatarAnimState.STAND,
    isNPC,
    receivedAt: 0,
    seq: -1,
    senderTimeMs: 0
  };
}

/** Copies three components, from a plain object or a three.js Vector3 or Euler, without allocating */
export function copyXyz(from: Readonly<Xyz>, to: Xyz) {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
}

/** Copies a quaternion, from a plain object or a three.js Quaternion, without allocating */
export function copyQuat(from: Readonly<Quat>, to: Quat) {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.w = from.w;
}

/** Copies position and Euler rotation into the part, which keeps its identity, and sets its quaternion to match */
export function copyTransform(from: Readonly<Transform>, to: TrackedPart) {
  copyXyz(from.pos, to.pos);
  copyXyz(from.rot, to.rot);
  eulerToQuat(to.rot, to.quat);
}

/** Writes the unit quaternion of YXZ Euler angles, as three.js's Quaternion.setFromEuler does for that order */
export function eulerToQuat(rot: Readonly<Rotation>, out: Quat) {
  const c1 = Math.cos(rot.x / 2);
  const c2 = Math.cos(rot.y / 2);
  const c3 = Math.cos(rot.z / 2);
  const s1 = Math.sin(rot.x / 2);
  const s2 = Math.sin(rot.y / 2);
  const s3 = Math.sin(rot.z / 2);
  out.x = s1 * c2 * c3 + c1 * s2 * s3;
  out.y = c1 * s2 * c3 - s1 * c2 * s3;
  out.z = c1 * c2 * s3 - s1 * s2 * c3;
  out.w = c1 * c2 * c3 + s1 * s2 * s3;
}

/**
 * Writes the YXZ Euler angles of a unit quaternion, as three.js's Euler.setFromQuaternion does for that
 * order: through the rotation matrix, with the whole turn put into the yaw at a pitch of ±90°.
 */
export function quatToEuler(quat: Readonly<Quat>, out: Rotation) {
  const { x, y, z, w } = quat;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;
  const m11 = 1 - (yy + zz);
  const m13 = xz + wy;
  const m21 = xy + wz;
  const m22 = 1 - (xx + zz);
  const m23 = yz - wx;
  const m31 = xz - wy;
  const m33 = 1 - (xx + yy);
  out.x = Math.asin(-Math.min(1, Math.max(-1, m23)));
  if (Math.abs(m23) < 0.9999999) {
    out.y = Math.atan2(m13, m33);
    out.z = Math.atan2(m21, m22);
  } else {
    out.y = Math.atan2(-m31, m11);
    out.z = 0;
  }
}
