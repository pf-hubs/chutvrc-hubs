import { Quaternion, Vector3 } from "three";

/** Where a foot stands in root space, kept from frame to frame while it is planted */
export type FootPlacement = { position: Vector3; planted: boolean };

/** How far the spot under the hips may move from a planted foot before the foot steps to it */
export const STEP_DISTANCE = 0.25;
/** A sitting avatar's feet: this far in front of the hips and this high over the floor */
export const SITTING_FOOT_FORWARD = 0.4;
export const SITTING_FOOT_HEIGHT = 0.3;

export function createFootPlacement(): FootPlacement {
  return { position: new Vector3(), planted: false };
}

/**
 * Where the foot would stand now: its rest offset from the hips turned with the body, under the hips, at
 * the height the rest pose stands at. The hips' height does not matter, so a crouch keeps the feet down.
 */
export function standingFootTarget(
  hips: Vector3,
  bodyDelta: Quaternion,
  restOffsetFromHips: Vector3,
  restFootHeight: number,
  out: Vector3
): Vector3 {
  out.copy(restOffsetFromHips).applyQuaternion(bodyDelta);
  out.x += hips.x;
  out.z += hips.z;
  out.y = restFootHeight;
  return out;
}

/** Where the foot goes while sitting: the standing spot moved forward and raised */
export function sittingFootTarget(
  hips: Vector3,
  bodyDelta: Quaternion,
  forward: Vector3,
  restOffsetFromHips: Vector3,
  out: Vector3
): Vector3 {
  standingFootTarget(hips, bodyDelta, restOffsetFromHips, SITTING_FOOT_HEIGHT, out);
  out.x += forward.x * SITTING_FOOT_FORWARD;
  out.z += forward.z * SITTING_FOOT_FORWARD;
  return out;
}

/**
 * Keeps the foot where it was planted until the spot it should stand on has moved away by the step
 * distance, then moves it there at once. Without planting the foot follows the spot every frame. Returns
 * the position the foot is at now.
 */
export function placeFoot(foot: FootPlacement, target: Vector3, plants: boolean): Vector3 {
  if (!plants || !foot.planted) {
    foot.position.copy(target);
    foot.planted = plants;
    return foot.position;
  }
  const dx = target.x - foot.position.x;
  const dz = target.z - foot.position.z;
  if (dx * dx + dz * dz > STEP_DISTANCE * STEP_DISTANCE) foot.position.copy(target);
  else foot.position.y = target.y;
  return foot.position;
}
