import { Euler, Quaternion, Vector3 } from "three";
import { Rotation } from "../../types/transform";
import { RigDescription } from "../rig/rig-description";
import { RestFrame } from "./rig-frames";

/**
 * Where the eyes are seen from the head bone when the model has no eye bones: a little up and forward,
 * in the model's units, which are metres for a model at scale one.
 */
export const FALLBACK_EYE_UP = 0.08;
export const FALLBACK_EYE_FORWARD = 0.08;
/** The own avatar stands this far behind the camera so the camera does not look out from inside its head */
export const SELF_BACK_OFFSET = 0.1;

const UP = new Vector3(0, 1, 0);
const euler = new Euler();
const restInverse = new Quaternion();
const headDelta = new Quaternion();
const restOffset = new Vector3();

/**
 * The yaw that turns the model's rest facing onto -z, the way the camera looks at zero yaw. The tracked
 * head and controllers are reported in that camera convention, so every bone is turned by this before the
 * tracked rotations apply; a model that faces +z is turned half around, a model that faces -z not at all.
 */
export function facingYaw(forward: Vector3): number {
  return -Math.atan2(-forward.x, -forward.z);
}

export function facingQuaternion(forward: Vector3, out: Quaternion): Quaternion {
  return out.setFromAxisAngle(UP, facingYaw(forward));
}

/** The rotation of a tracked part, reported as a YXZ Euler rotation in the rig's space */
export function trackedQuaternion(rotation: Rotation, out: Quaternion): Quaternion {
  return out.setFromEuler(euler.set(rotation.x, rotation.y, rotation.z, "YXZ"));
}

/**
 * The vector from the head bone to the midpoint of the eyes in root space, for the head turned to the
 * given orientation: the measured offset turned with the head, or the fallback turned the same way.
 */
export function eyeOffsetInRootSpace(
  rig: RigDescription,
  headRest: RestFrame,
  headQuaternion: Quaternion,
  out: Vector3
): Vector3 {
  if (rig.eyeOffsetFromHead) return out.copy(rig.eyeOffsetFromHead).applyQuaternion(headQuaternion);
  restInverse.copy(headRest.quaternion).invert();
  headDelta.copy(headQuaternion).multiply(restInverse);
  return out
    .copy(rig.forward)
    .multiplyScalar(FALLBACK_EYE_FORWARD)
    .addScaledVector(UP, FALLBACK_EYE_UP)
    .applyQuaternion(headDelta);
}

/** The height of the model's eyes over the floor in the rest pose, the height the headset is calibrated against */
export function rigEyeHeight(rig: RigDescription, headRest: RestFrame): number {
  if (!rig.eyeOffsetFromHead) return headRest.position.y + FALLBACK_EYE_UP;
  return headRest.position.y + restOffset.copy(rig.eyeOffsetFromHead).applyQuaternion(headRest.quaternion).y;
}

/**
 * Where the head bone goes so that the eyes sit at the headset: the headset position less the eye offset,
 * and for the own avatar a step back along the body's heading.
 */
export function headTarget(
  headsetPosition: Vector3,
  eyeOffset: Vector3,
  forward: Vector3,
  isSelf: boolean,
  out: Vector3
): Vector3 {
  out.copy(headsetPosition).sub(eyeOffset);
  if (isSelf) out.addScaledVector(forward, -SELF_BACK_OFFSET);
  return out;
}
