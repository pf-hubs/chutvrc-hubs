import { Euler, Quaternion, Vector3 } from "three";
import { RestFrames, SolvedFrames } from "./rig-frames";

/** The head's rotation relative to the body's heading, as the headset reports it: YXZ Euler angles in radians */
export type ChainAngles = { pitch: number; yaw: number; roll: number };

type ChainJoint = {
  name: "spine" | "chest" | "neck";
  /** The share of each angle this joint takes */
  pitch: number;
  yaw: number;
  roll: number;
  /** How far the joint may bend away from its rest pose, and how far it may twist about the body's up axis */
  swing: number;
  twist: number;
};

const DEGREE = Math.PI / 180;

/** From the hips up; a joint the model lacks is skipped and the head takes its share */
const CHAIN_JOINTS: readonly ChainJoint[] = [
  { name: "spine", pitch: 0.15, yaw: 0.15, roll: 0.05, swing: 25 * DEGREE, twist: 20 * DEGREE },
  { name: "chest", pitch: 0.2, yaw: 0.2, roll: 0.1, swing: 25 * DEGREE, twist: 25 * DEGREE },
  { name: "neck", pitch: 0.3, yaw: 0.3, roll: 0.25, swing: 35 * DEGREE, twist: 40 * DEGREE }
];

/** The head takes what the joints below leave, within these limits: wide enough for any ordinary look */
export const HEAD_SWING_LIMIT = 60 * DEGREE;
export const HEAD_TWIST_LIMIT = 80 * DEGREE;

const UP = new Vector3(0, 1, 0);
const euler = new Euler();
const jointRotation = new Quaternion();
const cumulative = new Quaternion();
const relative = new Quaternion();
const headRotation = new Quaternion();
const twist = new Quaternion();
const swing = new Quaternion();
const swingAxis = new Vector3();

function clamp(value: number, limit: number): number {
  return Math.min(limit, Math.max(-limit, value));
}

/**
 * Limits a rotation by its twist about the up axis and by its swing away from it, each to the given
 * angle, with the rotation split as swing after twist. Changes the rotation in place and returns it.
 */
function clampSwingTwist(rotation: Quaternion, maxSwing: number, maxTwist: number): Quaternion {
  if (rotation.w < 0) rotation.set(-rotation.x, -rotation.y, -rotation.z, -rotation.w);
  const twistAngle = 2 * Math.atan2(rotation.y, rotation.w);
  twist.setFromAxisAngle(UP, twistAngle);
  swing.copy(rotation).multiply(twist.invert());
  if (swing.w < 0) swing.set(-swing.x, -swing.y, -swing.z, -swing.w);
  const swingAngle = 2 * Math.acos(Math.min(1, swing.w));
  if (swingAngle > maxSwing) {
    swingAxis.set(swing.x, swing.y, swing.z).normalize();
    swing.setFromAxisAngle(swingAxis, maxSwing);
  }
  twist.setFromAxisAngle(UP, clamp(twistAngle, maxTwist));
  return rotation.copy(swing).multiply(twist);
}

/**
 * Turns the spine, chest and neck by their shares of the head's angles, each in the frame left by the
 * joint below, and gives the head the rest so it ends up at the headset's orientation unless its own
 * limits cut that short. Every orientation is written in root space as `body` (the heading) times the
 * joint's turn times `facing` (the yaw that brings the rest pose to the camera convention) times the rest
 * orientation. With `headTakesRemainder` false the head is left to follow its parent.
 */
export function solveSpineChain(
  rest: RestFrames,
  solved: SolvedFrames,
  body: Quaternion,
  facing: Quaternion,
  angles: ChainAngles,
  headTakesRemainder: boolean
) {
  cumulative.identity();
  for (const joint of CHAIN_JOINTS) {
    const frame = rest[joint.name];
    if (!frame) continue;
    euler.set(
      clamp(angles.pitch * joint.pitch, joint.swing),
      clamp(angles.yaw * joint.yaw, joint.twist),
      clamp(angles.roll * joint.roll, joint.swing),
      "YXZ"
    );
    cumulative.multiply(jointRotation.setFromEuler(euler));
    solved.quaternion[joint.name].copy(frame.quaternion).premultiply(facing).premultiply(cumulative).premultiply(body);
    solved.solved[joint.name] = true;
  }

  const head = rest.head;
  if (!headTakesRemainder || !head) return;
  relative.setFromEuler(euler.set(angles.pitch, angles.yaw, angles.roll, "YXZ"));
  headRotation.copy(cumulative).invert().multiply(relative);
  clampSwingTwist(headRotation, HEAD_SWING_LIMIT, HEAD_TWIST_LIMIT);
  cumulative.multiply(headRotation);
  solved.quaternion.head.copy(head.quaternion).premultiply(facing).premultiply(cumulative).premultiply(body);
  solved.solved.head = true;
}
