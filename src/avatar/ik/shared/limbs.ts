import { Vector3 } from "three";
import { BoneName } from "../../rig/bone-names";
import { RigDescription } from "../../rig/rig-description";
import { BodyHeading } from "./body-frame";
import { FootPlacement, placeFoot, sittingFootTarget, standingFootTarget } from "./feet";
import { Side, SmoothedTarget } from "./ik-state";
import { RestFrame, RestFrames, SolvedFrames } from "./rig-frames";
import { createTwoBoneOutput, solveTwoBone, TwoBoneInput, TwoBoneOutput } from "./two-bone-ik";

/**
 * The arms and legs as analytic two-bone limbs, each with a pole, and the smoothing of a tracked hand
 * target: what the solvers share once each has chosen where a hand or a foot should go.
 */

export type ArmBones = { upper: BoneName; lower: BoneName; hand: "leftHand" | "rightHand" };
export type LegBones = { upper: BoneName; lower: BoneName; foot: BoneName };

export const ARM_BONES: Record<Side, ArmBones> = {
  left: { upper: "leftUpperArm", lower: "leftLowerArm", hand: "leftHand" },
  right: { upper: "rightUpperArm", lower: "rightLowerArm", hand: "rightHand" }
};
export const LEG_BONES: Record<Side, LegBones> = {
  left: { upper: "leftUpperLeg", lower: "leftLowerLeg", foot: "leftFoot" },
  right: { upper: "rightUpperLeg", lower: "rightLowerLeg", foot: "rightFoot" }
};

/** A bone shorter than this cannot be solved */
const MIN_BONE_LENGTH = 1e-3;
/** About the old per-frame filter (0.3 of the way each frame at 60 Hz), but by time */
const HAND_SMOOTHING_TIME_CONSTANT = 0.045;
/** A hand that jumped this far was not moved but teleported: follow it at once */
const HAND_SNAP_DISTANCE = 1;
/** The elbows point down, back and a little out; the knees point forward */
const ELBOW_POLE_DOWN = 1;
const ELBOW_POLE_BACK = 0.7;
const ELBOW_POLE_OUT = 0.3;

/** A limb of two bones in the rest pose: its three joints and the lengths of its two bones */
export type RestLimb = {
  upper: RestFrame;
  lower: RestFrame;
  end: RestFrame;
  upperLength: number;
  lowerLength: number;
};

const limb: RestLimb = {
  upper: null as unknown as RestFrame,
  lower: null as unknown as RestFrame,
  end: null as unknown as RestFrame,
  upperLength: 0,
  lowerLength: 0
};
const twoBoneInput: TwoBoneInput = {
  root: new Vector3(),
  target: new Vector3(),
  pole: new Vector3(),
  upperLength: 0,
  lowerLength: 0,
  restUpper: new Vector3(),
  restLower: new Vector3(),
  restBend: new Vector3()
};
const twoBone = createTwoBoneOutput();
const restOffset = new Vector3();
const footTarget = new Vector3();
const armPole = new Vector3();
const armRestBend = new Vector3();

/** The limb's rest pose, or null when one of its bones is missing or too short to solve; the next call reuses the result */
function restLimb(rest: RestFrames, upperName: BoneName, lowerName: BoneName, endName: BoneName): RestLimb | null {
  const upper = rest[upperName];
  const lower = rest[lowerName];
  const end = rest[endName];
  if (!upper || !lower || !end) return null;
  const upperLength = upper.position.distanceTo(lower.position);
  const lowerLength = lower.position.distanceTo(end.position);
  if (upperLength < MIN_BONE_LENGTH || lowerLength < MIN_BONE_LENGTH) return null;
  limb.upper = upper;
  limb.lower = lower;
  limb.end = end;
  limb.upperLength = upperLength;
  limb.lowerLength = lowerLength;
  return limb;
}

export function restLeg(rest: RestFrames, side: Side): RestLimb | null {
  const bones = LEG_BONES[side];
  return restLimb(rest, bones.upper, bones.lower, bones.foot);
}

export function restArm(rest: RestFrames, side: Side): RestLimb | null {
  const bones = ARM_BONES[side];
  return restLimb(rest, bones.upper, bones.lower, bones.hand);
}

/**
 * Solves the limb from its root onto the target, the middle joint toward the pole, and writes the two
 * bones' orientations and the positions of the middle joint and the end into the solved frames. Returns
 * the solved turns, which the next solve overwrites.
 */
function solveLimb(
  solved: SolvedFrames,
  upperName: BoneName,
  lowerName: BoneName,
  endName: BoneName,
  limb: RestLimb,
  target: Vector3,
  pole: Vector3,
  restBend: Vector3
): TwoBoneOutput {
  twoBoneInput.root.copy(solved.position[upperName]);
  twoBoneInput.target.copy(target);
  twoBoneInput.pole.copy(pole);
  twoBoneInput.upperLength = limb.upperLength;
  twoBoneInput.lowerLength = limb.lowerLength;
  twoBoneInput.restUpper.subVectors(limb.lower.position, limb.upper.position).normalize();
  twoBoneInput.restLower.subVectors(limb.end.position, limb.lower.position).normalize();
  twoBoneInput.restBend.copy(restBend);
  solveTwoBone(twoBoneInput, twoBone);

  solved.quaternion[upperName].copy(limb.upper.quaternion).premultiply(twoBone.upperDelta);
  solved.solved[upperName] = true;
  solved.quaternion[lowerName].copy(limb.lower.quaternion).premultiply(twoBone.lowerDelta);
  solved.solved[lowerName] = true;
  solved.position[lowerName].copy(twoBone.joint);
  solved.position[endName].copy(twoBone.end);
  return twoBone;
}

/** Solves the leg from the hip joint onto the foot's position, the knee toward the body's forward */
export function solveLegTo(
  rig: RigDescription,
  solved: SolvedFrames,
  side: Side,
  leg: RestLimb,
  footPosition: Vector3,
  heading: BodyHeading
) {
  const bones = LEG_BONES[side];
  solveLimb(solved, bones.upper, bones.lower, bones.foot, leg, footPosition, heading.forward, rig.forward);
}

/**
 * Solves the arm from the shoulder onto the hand target, the elbow down, back and a little out from the
 * body's heading. Returns the solved turns, which the next solve overwrites.
 */
export function solveArmTo(
  rig: RigDescription,
  solved: SolvedFrames,
  side: Side,
  arm: RestLimb,
  target: Vector3,
  heading: BodyHeading
): TwoBoneOutput {
  const bones = ARM_BONES[side];
  const outward = side === "left" ? -1 : 1;
  armPole
    .set(0, -ELBOW_POLE_DOWN, 0)
    .addScaledVector(heading.forward, -ELBOW_POLE_BACK)
    .addScaledVector(heading.right, outward * ELBOW_POLE_OUT)
    .normalize();
  armRestBend.copy(rig.forward).negate();
  return solveLimb(solved, bones.upper, bones.lower, bones.hand, arm, target, armPole, armRestBend);
}

/**
 * A leg of a body that stands on the floor or sits: the foot goes to its rest spot under the hips, turned
 * with the body (in front of the hips and raised while sitting), and while standing stays planted until
 * the body has moved away from it; the foot turns with the body's heading. The hips are placed already.
 */
export function solvePlantedLeg(
  rig: RigDescription,
  rest: RestFrames,
  solved: SolvedFrames,
  feet: Record<Side, FootPlacement>,
  heading: BodyHeading,
  sitting: boolean,
  side: Side
) {
  const leg = restLeg(rest, side);
  if (!leg) return;
  const foot = leg.end;
  restOffset.subVectors(foot.position, rest.hips!.position);
  if (sitting) sittingFootTarget(solved.position.hips, heading.bodyDelta, heading.forward, restOffset, footTarget);
  else standingFootTarget(solved.position.hips, heading.bodyDelta, restOffset, foot.position.y, footTarget);
  const footPosition = placeFoot(feet[side], footTarget, !sitting);
  solveLegTo(rig, solved, side, leg, footPosition, heading);
  const footName = LEG_BONES[side].foot;
  solved.quaternion[footName].copy(foot.quaternion).premultiply(heading.bodyDelta);
  solved.solved[footName] = true;
}

/**
 * Brings a tracked hand target toward the smoothed one over time, or snaps the smoothed target to it on
 * the first frame and after a teleport. Changes the target in place and returns it.
 */
export function smoothHandTarget(smoothed: SmoothedTarget, target: Vector3, deltaSeconds: number): Vector3 {
  if (!smoothed.valid || smoothed.position.distanceToSquared(target) > HAND_SNAP_DISTANCE * HAND_SNAP_DISTANCE) {
    smoothed.position.copy(target);
    smoothed.valid = true;
    return target;
  }
  smoothed.position.lerp(target, 1 - Math.exp(-deltaSeconds / HAND_SMOOTHING_TIME_CONSTANT));
  return target.copy(smoothed.position);
}
