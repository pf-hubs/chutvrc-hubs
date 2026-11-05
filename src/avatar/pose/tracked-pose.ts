import { Transform } from "../../types/transform";
import { AvatarAnimState } from "../../types/avatar-types";

type Xyz = { x: number; y: number; z: number };

/**
 * The pose of one avatar as the solver reads it: the rig and the three tracked parts, each as a position
 * and a YXZ Euler rotation in the rig's space, the way the headset and controllers report them.
 *
 * The four part objects are allocated once per avatar and updated in place, never replaced: the solver
 * keeps references to them, and a received packet, the local sampler and the chatbot all write into them.
 */
export type TrackedPose = {
  rig: Transform;
  head: Transform;
  leftHand: Transform;
  rightHand: Transform;
  /** Whether the client's headset is presenting; the solver moves the hands from the controllers only then */
  isVR: boolean;
  animState: AvatarAnimState;
  /** A pose written by the chatbot rather than received from a client; solved only on the frames it is written */
  isNPC: boolean;
  /** performance.now() of the last write to any part; 0 until the first write */
  receivedAt: number;
};

const zeroTransform = (): Transform => ({ pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } });

/** A pose at the origin, not in VR and standing: what the solver assumed before a client's first packet */
export function createTrackedPose(isNPC = false): TrackedPose {
  return {
    rig: zeroTransform(),
    head: zeroTransform(),
    leftHand: zeroTransform(),
    rightHand: zeroTransform(),
    isVR: false,
    animState: AvatarAnimState.STAND,
    isNPC,
    receivedAt: 0
  };
}

/** Copies three components, from a plain object or a three.js Vector3 or Euler, without allocating */
export function copyXyz(from: Readonly<Xyz>, to: Xyz) {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
}

/** Copies position and rotation into the target, which keeps its identity */
export function copyTransform(from: Readonly<Transform>, to: Transform) {
  copyXyz(from.pos, to.pos);
  copyXyz(from.rot, to.rot);
}
