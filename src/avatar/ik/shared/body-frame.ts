import { Euler, Quaternion, Vector3 } from "three";
import { TrackedPose } from "../../pose/tracked-pose";
import { BODY_BONE_NAMES, BoneName } from "../../rig/bone-names";
import { RigDescription } from "../../rig/rig-description";
import { BoneWrites, clearBoneWrites } from "./bone-writes";
import { facingQuaternion } from "./head";
import { IkState, SolveFrame } from "./ik-state";
import {
  clearSolvedFrames,
  followAncestor,
  localPositionOf,
  localRotationOf,
  RestFrames,
  SolvedFrames
} from "./rig-frames";

/**
 * The steps every solver takes in a frame around its own placement of the body: starting the frame,
 * the rig's root, the body's heading, the bones that follow the spine and the final local rotations.
 */

/** The chain the hips carry, from the hips up; measured hanging from the origin to place the hips under the head */
export const SPINE_CHAIN: readonly BoneName[] = ["spine", "chest", "neck", "head"];
/** Every bone whose position follows from the chain, ancestors first; the limbs below them are solved on their own */
const CHAIN_FOLLOWERS: readonly BoneName[] = [
  ...SPINE_CHAIN,
  "leftShoulder",
  "leftUpperArm",
  "rightShoulder",
  "rightUpperArm",
  "leftUpperLeg",
  "rightUpperLeg"
];

const UP = new Vector3(0, 1, 0);
const euler = new Euler();

/**
 * Starts a frame: clears the writes and the solved frames and, when the model has a root and hips to
 * solve, marks the root solved and returns the time since the previous frame in seconds, at most one, 0
 * on the first. Returns null, and leaves the clock alone, when there is nothing to solve.
 */
export function beginFrame(state: IkState, out: BoneWrites, frame: SolveFrame): number | null {
  clearBoneWrites(out);
  const rest = state.frames;
  const solved = state.solved;
  clearSolvedFrames(solved);
  if (!rest.root || !rest.hips) return null;

  const deltaSeconds = state.lastNow > 0 ? Math.min(Math.max((frame.now - state.lastNow) / 1000, 0), 1) : 0;
  state.lastNow = frame.now;
  solved.solved.root = true;
  return deltaSeconds;
}

/** The root takes the rig transform as it is: its position, and its yaw and pitch */
export function writeRoot(pose: TrackedPose, out: BoneWrites) {
  out.position.root.set(pose.rig.pos.x, pose.rig.pos.y, pose.rig.pos.z);
  out.hasPosition.root = true;
  out.rotation.root.setFromEuler(euler.set(pose.rig.rot.x, pose.rig.rot.y, 0, "YXZ"));
  out.hasRotation.root = true;
}

/** The body's heading in a frame and the turns that follow from it, all in root space */
export type BodyHeading = {
  /** The yaw that brings the model's rest facing onto -z, the camera convention */
  facing: Quaternion;
  /** The heading as a turn about the up axis */
  body: Quaternion;
  /** The heading after the facing: what turns a bone's rest orientation to the heading */
  bodyDelta: Quaternion;
  forward: Vector3;
  right: Vector3;
};

export function createBodyHeading(): BodyHeading {
  return {
    facing: new Quaternion(),
    body: new Quaternion(),
    bodyDelta: new Quaternion(),
    forward: new Vector3(),
    right: new Vector3()
  };
}

/** Sets the heading from the body's yaw in root space, where zero faces -z */
export function setBodyHeading(rig: RigDescription, bodyYaw: number, out: BodyHeading): BodyHeading {
  facingQuaternion(rig.forward, out.facing);
  out.body.setFromAxisAngle(UP, bodyYaw);
  out.bodyDelta.copy(out.body).multiply(out.facing);
  out.forward.set(0, 0, -1).applyQuaternion(out.body);
  out.right.set(1, 0, 0).applyQuaternion(out.body);
  return out;
}

/** Places the spine, the head, the shoulders and the hip joints where the placed hips and the turned chain carry them */
export function followChain(rest: RestFrames, solved: SolvedFrames) {
  for (const name of CHAIN_FOLLOWERS) followAncestor(rest, solved, name);
}

/** Writes the placed hips as the local position of their bone */
export function writeHips(rest: RestFrames, solved: SolvedFrames, out: BoneWrites) {
  localPositionOf(rest, solved, "hips", out.position.hips);
  out.hasPosition.hips = true;
}

/** Writes every solved bone's orientation, but the root's, as the local rotation its object needs */
export function writeSolvedRotations(rest: RestFrames, solved: SolvedFrames, out: BoneWrites) {
  for (const name of BODY_BONE_NAMES) {
    if (name === "root" || !solved.solved[name]) continue;
    localRotationOf(rest, solved, name, out.rotation[name]);
    out.hasRotation[name] = true;
  }
}
