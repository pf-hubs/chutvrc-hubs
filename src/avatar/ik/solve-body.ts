import { Euler, Quaternion, Vector3 } from "three";
import { AvatarAnimState } from "../../types/avatar-types";
import { Transform } from "../../types/transform";
import { TrackedPose } from "../pose/tracked-pose";
import { BODY_BONE_NAMES, BodyBoneName, BoneName, bodyBoneRecord } from "../rig/bone-names";
import { RigDescription } from "../rig/rig-description";
import { BodyYawState, createBodyYawState, updateBodyYaw, wrapAngle } from "./body-yaw";
import { Calibration, calibrateHeight, createCalibration, scaleHeight } from "./calibration";
import { createFootPlacement, FootPlacement, placeFoot, sittingFootTarget, standingFootTarget } from "./feet";
import {
  eyeOffsetInRootSpace,
  facingQuaternion,
  facingYaw,
  headTarget,
  rigEyeHeight,
  SELF_BACK_OFFSET,
  trackedQuaternion
} from "./head";
import {
  clearSolvedFrames,
  createSolvedFrames,
  followAncestor,
  localPositionOf,
  localRotationOf,
  RestFrames,
  SolvedFrames
} from "./rig-frames";
import { ChainAngles, solveSpineChain } from "./spine-chain";
import { createTwoBoneOutput, solveTwoBone, TwoBoneInput } from "./two-bone-ik";

/**
 * The body solver: pure functions over the rig description and a tracked pose. It works in root space,
 * the rig's space, where the tracked head and controllers are already expressed, and leaves the scene
 * objects to apply-to-bones.
 */

/** The bones whose local position is written as well as their rotation */
export type PositionBoneName = "root" | "hips" | "leftHand" | "rightHand";

export function isPositionBone(name: BoneName): name is PositionBoneName {
  return name === "root" || name === "hips" || name === "leftHand" || name === "rightHand";
}

/** What the solver writes in a frame: a local rotation per solved bone, a local position for a few, allocated once */
export type BoneWrites = {
  rotation: Record<BodyBoneName, Quaternion>;
  hasRotation: Record<BodyBoneName, boolean>;
  position: Record<PositionBoneName, Vector3>;
  hasPosition: Record<PositionBoneName, boolean>;
  /** The hands of an upper-body model are hidden while they have no controller to follow */
  handsHidden: boolean;
};

export function createBoneWrites(): BoneWrites {
  const rotation = bodyBoneRecord<Quaternion>(null as unknown as Quaternion);
  for (const name of BODY_BONE_NAMES) rotation[name] = new Quaternion();
  return {
    rotation,
    hasRotation: bodyBoneRecord(false),
    position: { root: new Vector3(), hips: new Vector3(), leftHand: new Vector3(), rightHand: new Vector3() },
    hasPosition: { root: false, hips: false, leftHand: false, rightHand: false },
    handsHidden: false
  };
}

function clearBoneWrites(out: BoneWrites) {
  for (const name of BODY_BONE_NAMES) out.hasRotation[name] = false;
  out.hasPosition.root = false;
  out.hasPosition.hips = false;
  out.hasPosition.leftHand = false;
  out.hasPosition.rightHand = false;
  out.handsHidden = false;
}

type Side = "left" | "right";

/** A hand target smoothed over time, as the old solver smoothed the controller positions */
type SmoothedTarget = { position: Vector3; valid: boolean };

/** What the solver keeps between frames for one avatar */
export type IkState = {
  frames: RestFrames;
  solved: SolvedFrames;
  calibration: Calibration;
  bodyYaw: BodyYawState;
  feet: Record<Side, FootPlacement>;
  hands: Record<Side, SmoothedTarget>;
  /** When the last frame was solved, in milliseconds; 0 before the first */
  lastNow: number;
};

export function createIkState(frames: RestFrames): IkState {
  return {
    frames,
    solved: createSolvedFrames(),
    calibration: createCalibration(),
    bodyYaw: createBodyYawState(),
    feet: { left: createFootPlacement(), right: createFootPlacement() },
    hands: { left: { position: new Vector3(), valid: false }, right: { position: new Vector3(), valid: false } },
    lastNow: 0
  };
}

/** What a frame adds to the pose: its time, and whether the avatar is the own one */
export type SolveFrame = { now: number; isSelf: boolean };

type ArmBones = { upper: BoneName; lower: BoneName; hand: "leftHand" | "rightHand" };
type LegBones = { upper: BoneName; lower: BoneName; foot: BoneName };

const ARM_BONES: Record<Side, ArmBones> = {
  left: { upper: "leftUpperArm", lower: "leftLowerArm", hand: "leftHand" },
  right: { upper: "rightUpperArm", lower: "rightLowerArm", hand: "rightHand" }
};
const LEG_BONES: Record<Side, LegBones> = {
  left: { upper: "leftUpperLeg", lower: "leftLowerLeg", foot: "leftFoot" },
  right: { upper: "rightUpperLeg", lower: "rightLowerLeg", foot: "rightFoot" }
};

/** The chain the hips carry, from the hips up; measured hanging from the origin to place the hips under the head */
const SPINE_CHAIN: readonly BoneName[] = ["spine", "chest", "neck", "head"];
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

/** The old solver's gap between the headset and the head bone, used when the model has no head to measure */
const HEAD_BELOW_HEADSET = 0.05;
/** How far below the exact eye height the body stands in VR, so the legs are not straight when the user stands */
const STANDING_KNEE_SLACK = 0.03;
/** A bone shorter than this cannot be solved */
const MIN_BONE_LENGTH = 1e-3;
const EPSILON = 1e-8;
/** About the old per-frame filter (0.3 of the way each frame at 60 Hz), but by time */
const HAND_SMOOTHING_TIME_CONSTANT = 0.045;
/** A hand that jumped this far was not moved but teleported: follow it at once */
const HAND_SNAP_DISTANCE = 1;
/** A desktop user's arms hang at the sides, slightly forward and bent, in fractions of the arm's length */
const RELAXED_ARM_DOWN = 0.93;
const RELAXED_ARM_FORWARD = 0.12;
const RELAXED_ARM_OUT = 0.1;
/** The elbows point down, back and a little out; the knees point forward */
const ELBOW_POLE_DOWN = 1;
const ELBOW_POLE_BACK = 0.7;
const ELBOW_POLE_OUT = 0.3;

const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);

/**
 * The turn from the controller's orientation to the hand bone's, as the old solver applied it: a quarter
 * turn about z for a model that faces -z, a third of a turn about x for one that faces +z.
 */
const HAND_CORRECTION_FLIPPED: Record<Side, Quaternion> = {
  left: new Quaternion().setFromAxisAngle(Z_AXIS, Math.PI / 2),
  right: new Quaternion().setFromAxisAngle(Z_AXIS, -Math.PI / 2)
};
const HAND_CORRECTION_UNFLIPPED = new Quaternion().setFromAxisAngle(X_AXIS, -Math.PI / 3);

const euler = new Euler();
const facing = new Quaternion();
const body = new Quaternion();
const bodyInverse = new Quaternion();
const bodyDelta = new Quaternion();
const controller = new Quaternion();
const aim = new Quaternion();
const forward = new Vector3();
const right = new Vector3();
const headsetPosition = new Vector3();
const eyeOffset = new Vector3();
const target = new Vector3();
const restOffset = new Vector3();
const restUp = new Vector3();
const toTarget = new Vector3();
const angles: ChainAngles = { pitch: 0, yaw: 0, roll: 0 };
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

function handCorrection(rig: RigDescription, side: Side): Quaternion {
  return rig.isFlippedY ? HAND_CORRECTION_FLIPPED[side] : HAND_CORRECTION_UNFLIPPED;
}

/**
 * The angles the chain distributes. A tracked head gives its own pitch, its yaw relative to the body's
 * heading and, in VR, its roll. A chatbot gives the head a position to lean toward rather than an
 * orientation, so the chain bends toward it without twisting, as the old solver aimed it.
 */
function chainAngles(rest: RestFrames, pose: TrackedPose, bodyYaw: number, out: ChainAngles) {
  if (!pose.isNPC) {
    out.pitch = pose.head.rot.x;
    out.yaw = wrapAngle(pose.head.rot.y - bodyYaw);
    out.roll = pose.isVR ? pose.head.rot.z : 0;
    return;
  }
  out.pitch = 0;
  out.yaw = 0;
  out.roll = 0;
  const head = rest.head;
  const hips = rest.hips;
  if (!head || !hips) return;
  restUp.subVectors(head.position, hips.position);
  toTarget.subVectors(headsetPosition, hips.position);
  if (restUp.lengthSq() < EPSILON || toTarget.lengthSq() < EPSILON) return;
  aim.setFromUnitVectors(restUp.normalize(), toTarget.normalize());
  aim.premultiply(bodyInverse.copy(body).invert()).multiply(body);
  euler.setFromQuaternion(aim, "YXZ");
  out.pitch = euler.x;
  out.roll = euler.z;
}

/**
 * Where the hips go. In VR they hang below the head target by the solved chain, so the eyes land on the
 * headset, a little lower so the knees keep a bend and the planted feet stay in reach while the hips sway;
 * on a desktop they stay at their rest height under the rig's origin; a chatbot places its own.
 */
function placeHips(rig: RigDescription, rest: RestFrames, solved: SolvedFrames, pose: TrackedPose, isSelf: boolean) {
  const hips = rest.hips!;
  const position = solved.position.hips;
  if (pose.isNPC) {
    position.copy(hips.position);
    return;
  }
  if (!pose.isVR) {
    position.set(0, hips.position.y, 0);
  } else if (rest.head) {
    position.set(0, 0, 0);
    for (const name of SPINE_CHAIN) followAncestor(rest, solved, name);
    eyeOffsetInRootSpace(rig, rest.head, solved.quaternion.head, eyeOffset);
    headTarget(headsetPosition, eyeOffset, forward, isSelf, target);
    target.y -= STANDING_KNEE_SLACK;
    position.copy(target).sub(solved.position.head);
    return;
  } else {
    position.set(headsetPosition.x, headsetPosition.y - rig.lengths.hipsToHead - HEAD_BELOW_HEADSET, headsetPosition.z);
  }
  if (isSelf) position.addScaledVector(forward, -SELF_BACK_OFFSET);
}

/** The controller's position in the model's proportions, smoothed over time when a smoothing target is given */
function trackedHandTarget(
  hand: Transform,
  state: IkState,
  smoothed: SmoothedTarget | null,
  deltaSeconds: number,
  out: Vector3
): Vector3 {
  out.set(hand.pos.x, scaleHeight(state.calibration, hand.pos.y), hand.pos.z);
  if (!smoothed) return out;
  if (!smoothed.valid || smoothed.position.distanceToSquared(out) > HAND_SNAP_DISTANCE * HAND_SNAP_DISTANCE) {
    smoothed.position.copy(out);
    smoothed.valid = true;
    return out;
  }
  smoothed.position.lerp(out, 1 - Math.exp(-deltaSeconds / HAND_SMOOTHING_TIME_CONSTANT));
  return out.copy(smoothed.position);
}

function solveLeg(
  rig: RigDescription,
  rest: RestFrames,
  solved: SolvedFrames,
  state: IkState,
  pose: TrackedPose,
  side: Side
) {
  const bones = LEG_BONES[side];
  const upper = rest[bones.upper];
  const lower = rest[bones.lower];
  const foot = rest[bones.foot];
  const hips = rest.hips!;
  if (!upper || !lower || !foot) return;
  const upperLength = upper.position.distanceTo(lower.position);
  const lowerLength = lower.position.distanceTo(foot.position);
  if (upperLength < MIN_BONE_LENGTH || lowerLength < MIN_BONE_LENGTH) return;

  const sitting = !pose.isNPC && pose.animState === AvatarAnimState.SIT;
  restOffset.subVectors(foot.position, hips.position);
  if (sitting) sittingFootTarget(solved.position.hips, bodyDelta, forward, restOffset, target);
  else standingFootTarget(solved.position.hips, bodyDelta, restOffset, foot.position.y, target);
  const footPosition = placeFoot(state.feet[side], target, !sitting && !pose.isNPC);

  twoBoneInput.root.copy(solved.position[bones.upper]);
  twoBoneInput.target.copy(footPosition);
  twoBoneInput.pole.copy(forward);
  twoBoneInput.upperLength = upperLength;
  twoBoneInput.lowerLength = lowerLength;
  twoBoneInput.restUpper.subVectors(lower.position, upper.position).normalize();
  twoBoneInput.restLower.subVectors(foot.position, lower.position).normalize();
  twoBoneInput.restBend.copy(rig.forward);
  solveTwoBone(twoBoneInput, twoBone);

  solved.quaternion[bones.upper].copy(upper.quaternion).premultiply(twoBone.upperDelta);
  solved.solved[bones.upper] = true;
  solved.quaternion[bones.lower].copy(lower.quaternion).premultiply(twoBone.lowerDelta);
  solved.solved[bones.lower] = true;
  solved.position[bones.lower].copy(twoBone.joint);
  solved.position[bones.foot].copy(twoBone.end);
  if (pose.isNPC) {
    followAncestor(rest, solved, bones.foot);
  } else {
    solved.quaternion[bones.foot].copy(foot.quaternion).premultiply(bodyDelta);
    solved.solved[bones.foot] = true;
  }
}

function solveArm(
  rig: RigDescription,
  rest: RestFrames,
  solved: SolvedFrames,
  state: IkState,
  pose: TrackedPose,
  out: BoneWrites,
  deltaSeconds: number,
  side: Side
) {
  const bones = ARM_BONES[side];
  const hand = rest[bones.hand];
  if (!hand) return;
  const upper = rest[bones.upper];
  const lower = rest[bones.lower];
  const input = side === "left" ? pose.leftHand : pose.rightHand;
  const tracked = pose.isVR || pose.isNPC;
  const turnsWithController = tracked && !pose.isNPC;

  if (rig.isHalfBody) {
    // The hands hang from the spine without arms: placed from the controllers, or hidden without them
    if (!tracked) {
      out.handsHidden = true;
      return;
    }
    if (pose.isNPC) return;
    trackedHandTarget(input, state, null, deltaSeconds, solved.position[bones.hand]);
    solved.quaternion[bones.hand].copy(trackedQuaternion(input.rot, controller)).multiply(handCorrection(rig, side));
    solved.solved[bones.hand] = true;
    localPositionOf(rest, solved, bones.hand, out.position[bones.hand]);
    out.hasPosition[bones.hand] = true;
    return;
  }

  const upperLength = upper && lower ? upper.position.distanceTo(lower.position) : 0;
  const lowerLength = upper && lower ? lower.position.distanceTo(hand.position) : 0;
  if (!upper || !lower || upperLength < MIN_BONE_LENGTH || lowerLength < MIN_BONE_LENGTH) {
    // A hand without an arm to carry it follows its parent and only turns with the controller
    followAncestor(rest, solved, bones.hand);
    if (turnsWithController) {
      solved.quaternion[bones.hand].copy(trackedQuaternion(input.rot, controller)).multiply(handCorrection(rig, side));
      solved.solved[bones.hand] = true;
    }
    return;
  }

  const shoulder = solved.position[bones.upper];
  const armLength = upperLength + lowerLength;
  const outward = side === "left" ? -1 : 1;
  if (tracked) {
    trackedHandTarget(input, state, state.hands[side], deltaSeconds, target);
  } else {
    target
      .copy(shoulder)
      .addScaledVector(UP, -RELAXED_ARM_DOWN * armLength)
      .addScaledVector(forward, RELAXED_ARM_FORWARD * armLength)
      .addScaledVector(right, outward * RELAXED_ARM_OUT * armLength);
  }

  twoBoneInput.root.copy(shoulder);
  twoBoneInput.target.copy(target);
  twoBoneInput.pole
    .set(0, -ELBOW_POLE_DOWN, 0)
    .addScaledVector(forward, -ELBOW_POLE_BACK)
    .addScaledVector(right, outward * ELBOW_POLE_OUT)
    .normalize();
  twoBoneInput.upperLength = upperLength;
  twoBoneInput.lowerLength = lowerLength;
  twoBoneInput.restUpper.subVectors(lower.position, upper.position).normalize();
  twoBoneInput.restLower.subVectors(hand.position, lower.position).normalize();
  twoBoneInput.restBend.copy(rig.forward).negate();
  solveTwoBone(twoBoneInput, twoBone);

  solved.quaternion[bones.upper].copy(upper.quaternion).premultiply(twoBone.upperDelta);
  solved.solved[bones.upper] = true;
  solved.quaternion[bones.lower].copy(lower.quaternion).premultiply(twoBone.lowerDelta);
  solved.solved[bones.lower] = true;
  solved.position[bones.lower].copy(twoBone.joint);
  solved.position[bones.hand].copy(twoBone.end);
  if (turnsWithController) {
    solved.quaternion[bones.hand].copy(trackedQuaternion(input.rot, controller)).multiply(handCorrection(rig, side));
    solved.solved[bones.hand] = true;
  } else if (pose.isNPC) {
    followAncestor(rest, solved, bones.hand);
  } else {
    // Without a controller the hand keeps its rest pose on the forearm
    solved.quaternion[bones.hand].copy(hand.quaternion).premultiply(twoBone.lowerDelta);
    solved.solved[bones.hand] = true;
  }
}

/**
 * Solves one avatar for one frame. The root takes the rig transform as it is. The body's heading trails
 * the head's yaw; the spine distributes the head's turn and the head lands on the headset's orientation;
 * the hips are placed so the eyes land on the headset, in the model's proportions once the height is
 * calibrated; the legs reach the planted feet and the arms the controllers, each as an analytic two-bone
 * limb with a pole; on a desktop the arms hang and the hips rest. A chatbot's avatar keeps the root and
 * hips it was given and the old solver's gates: its head, hands and feet are not turned. Bones the model
 * lacks are skipped. Nothing is allocated per frame.
 */
export function solveBody(rig: RigDescription, pose: TrackedPose, state: IkState, out: BoneWrites, frame: SolveFrame) {
  clearBoneWrites(out);
  const rest = state.frames;
  const solved = state.solved;
  clearSolvedFrames(solved);
  const hips = rest.hips;
  if (!rest.root || !hips) return;

  const deltaSeconds = state.lastNow > 0 ? Math.min(Math.max((frame.now - state.lastNow) / 1000, 0), 1) : 0;
  state.lastNow = frame.now;
  const { isVR, isNPC } = pose;
  solved.solved.root = true;

  if (!isNPC) {
    out.position.root.set(pose.rig.pos.x, pose.rig.pos.y, pose.rig.pos.z);
    out.hasPosition.root = true;
    out.rotation.root.setFromEuler(euler.set(pose.rig.rot.x, pose.rig.rot.y, 0, "YXZ"));
    out.hasRotation.root = true;
  }

  // The body's heading; a chatbot's body keeps the rest heading, which the facing yaw brings to zero
  facingQuaternion(rig.forward, facing);
  const bodyYaw = isNPC ? -facingYaw(rig.forward) : updateBodyYaw(state.bodyYaw, pose.head.rot.y, deltaSeconds);
  body.setFromAxisAngle(UP, bodyYaw);
  bodyDelta.copy(body).multiply(facing);
  forward.set(0, 0, -1).applyQuaternion(body);
  right.set(1, 0, 0).applyQuaternion(body);

  // The headset in the model's proportions
  if (isVR && !isNPC && rest.head) calibrateHeight(state.calibration, pose.head.pos.y, rigEyeHeight(rig, rest.head));
  headsetPosition.set(pose.head.pos.x, scaleHeight(state.calibration, pose.head.pos.y), pose.head.pos.z);

  // The hips and the chain above them
  solved.quaternion.hips.copy(hips.quaternion).premultiply(bodyDelta);
  solved.solved.hips = !isNPC;
  chainAngles(rest, pose, bodyYaw, angles);
  solveSpineChain(rest, solved, body, facing, angles, !isNPC);
  placeHips(rig, rest, solved, pose, frame.isSelf);
  if (!isNPC) {
    localPositionOf(rest, solved, "hips", out.position.hips);
    out.hasPosition.hips = true;
  }
  for (const name of CHAIN_FOLLOWERS) followAncestor(rest, solved, name);

  solveLeg(rig, rest, solved, state, pose, "left");
  solveLeg(rig, rest, solved, state, pose, "right");
  solveArm(rig, rest, solved, state, pose, out, deltaSeconds, "left");
  solveArm(rig, rest, solved, state, pose, out, deltaSeconds, "right");

  for (const name of BODY_BONE_NAMES) {
    if (name === "root" || !solved.solved[name]) continue;
    localRotationOf(rest, solved, name, out.rotation[name]);
    out.hasRotation[name] = true;
  }
}
