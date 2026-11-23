import { Matrix4, Quaternion, Vector3 } from "three";
import { Side } from "../shared/ik-state";

/**
 * How a hand lies around a controller: the hand's own frame (rig/hand-frame.ts: x along the fingers, y out
 * of the back of the hand, z = x × y) in the controller's axes. A controller's pose here is that of its
 * pointing ray, x to the right, y up and -z along the ray, moved back to the wrist
 * (systems/userinput/devices/webxr-controller.js).
 *
 * The grip is a handshake's: the fingers along the ray, the back of the hand outward (to the right for
 * the right hand, to the left for the left), the thumb on top. From there it is adjusted by three angles,
 * the same for every model and mirrored for the left hand:
 *
 * - raise: the fingers point this far above the ray. A controller's ray points below the line of the
 *   forearm that holds it; the wrist offset in webxr-controller.js puts the wrist 12 cm behind and 3 cm
 *   below the ray's origin, which is 14° by itself.
 * - roll: the palm turned this far downward, about the fingers.
 * - bend: the fingers bent this far toward the palm's side.
 *
 * The values were chosen without a headset and are meant to be tuned on one. For that, the address
 * parameter `hand_grip=raise,roll,bend` (degrees) replaces them while a page runs.
 */
export const HAND_GRIP_DEGREES = { raise: 20, roll: 0, bend: 0 };

const DEGREE = Math.PI / 180;
const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/** The handshake itself: the hand's x, y and z axes in the controller's axes */
const HANDSHAKE: Record<Side, [Vector3, Vector3, Vector3]> = {
  left: [new Vector3(0, 0, -1), new Vector3(-1, 0, 0), new Vector3(0, 1, 0)],
  right: [new Vector3(0, 0, -1), new Vector3(1, 0, 0), new Vector3(0, -1, 0)]
};

/**
 * The grip of one hand for the given angles in degrees. In the hand's own frame, raising the fingers is a
 * turn about y, rolling the palm down a turn about x and bending toward the palm a turn about z; a left
 * hand is the mirror image of a right one, so the first two turn the other way for it.
 */
export function buildHandGrip(side: Side, raise: number, roll: number, bend: number): Quaternion {
  const mirror = side === "left" ? -1 : 1;
  const [x, y, z] = HANDSHAKE[side];
  const turn = new Quaternion();
  return new Quaternion()
    .setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))
    .multiply(turn.setFromAxisAngle(Y_AXIS, mirror * raise * DEGREE))
    .multiply(turn.setFromAxisAngle(X_AXIS, -mirror * roll * DEGREE))
    .multiply(turn.setFromAxisAngle(Z_AXIS, -bend * DEGREE));
}

/** The angles from the `hand_grip` address parameter, or the built-in ones when it is absent or not three numbers */
function gripDegrees(): { raise: number; roll: number; bend: number } {
  // The solver also runs outside a page, in the offline tests
  if (typeof location === "undefined") return HAND_GRIP_DEGREES;
  const given = new URLSearchParams(location.search).get("hand_grip");
  if (!given) return HAND_GRIP_DEGREES;
  const [raise, roll, bend] = given.split(",").map(Number);
  if (![raise, roll, bend].every(Number.isFinite)) return HAND_GRIP_DEGREES;
  console.log(`Hand grip from the address: raise ${raise}°, roll ${roll}°, bend ${bend}°`);
  return { raise, roll, bend };
}

const degrees = gripDegrees();

/** The grip of each hand, fixed when the page loads */
export const handGrip: Record<Side, Quaternion> = {
  left: buildHandGrip("left", degrees.raise, degrees.roll, degrees.bend),
  right: buildHandGrip("right", degrees.raise, degrees.roll, degrees.bend)
};
