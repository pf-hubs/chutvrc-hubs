import { Quaternion, Vector3 } from "three";
import { TrackedPart, TrackedPose } from "../../pose/tracked-pose";
import { RigDescription } from "../../rig/rig-description";
import { AvatarAnimState } from "../../../types/avatar-types";
import { Calibration, calibrateHeight, scaleHeight } from "../calibration";
import { wrapAngle, updateBodyYaw } from "../shared/body-yaw";
import {
  BodyHeading,
  beginFrame,
  createBodyHeading,
  followChain,
  setBodyHeading,
  SPINE_CHAIN,
  writeHips,
  writeRoot,
  writeSolvedRotations
} from "../shared/body-frame";
import { BoneWrites } from "../shared/bone-writes";
import { eyeOffsetInRootSpace, headTarget, rigEyeHeight, SELF_BACK_OFFSET, trackedQuaternion } from "../shared/head";
import { IkState, Side, SolveFrame } from "../shared/ik-state";
import { ARM_BONES, restArm, smoothHandTarget, solveArmTo, solvePlantedLeg } from "../shared/limbs";
import { followAncestor, localPositionOf, RestFrames, SolvedFrames } from "../shared/rig-frames";
import { ChainAngles, solveSpineChain } from "../shared/spine-chain";

/**
 * The VR solver, for a pose whose sender's headset is presenting: the eyes on the headset, the hands on
 * the controllers, the hips hung from the head and the legs reaching planted feet. The tracked heights are
 * brought into the model's proportions by the height calibration.
 */

/** The old solver's gap between the headset and the head bone, used when the model has no head to measure */
const HEAD_BELOW_HEADSET = 0.05;
/** How far below the exact eye height the body stands, so the legs are not straight when the user stands */
const STANDING_KNEE_SLACK = 0.03;

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

const heading: BodyHeading = createBodyHeading();
const controller = new Quaternion();
const headsetPosition = new Vector3();
const eyeOffset = new Vector3();
const target = new Vector3();
const angles: ChainAngles = { pitch: 0, yaw: 0, roll: 0 };

function handCorrection(rig: RigDescription, side: Side): Quaternion {
  return rig.isFlippedY ? HAND_CORRECTION_FLIPPED[side] : HAND_CORRECTION_UNFLIPPED;
}

/** The controller's position in the model's proportions */
function controllerTarget(hand: TrackedPart, calibration: Calibration, out: Vector3): Vector3 {
  return out.set(hand.pos.x, scaleHeight(calibration, hand.pos.y), hand.pos.z);
}

/** Turns the hand bone to the controller's orientation */
function turnWithController(rig: RigDescription, solved: SolvedFrames, hand: TrackedPart, side: Side) {
  const name = ARM_BONES[side].hand;
  solved.quaternion[name].copy(trackedQuaternion(hand.rot, controller)).multiply(handCorrection(rig, side));
  solved.solved[name] = true;
}

/**
 * Where the hips go: below the head target by the solved chain, so the eyes land on the headset, a little
 * lower so the knees keep a bend and the planted feet stay in reach while the hips sway. Without a head to
 * measure, the old solver's offset below the headset is used.
 */
function placeHips(rig: RigDescription, rest: RestFrames, solved: SolvedFrames, isSelf: boolean) {
  const position = solved.position.hips;
  if (rest.head) {
    position.set(0, 0, 0);
    for (const name of SPINE_CHAIN) followAncestor(rest, solved, name);
    eyeOffsetInRootSpace(rig, rest.head, solved.quaternion.head, eyeOffset);
    headTarget(headsetPosition, eyeOffset, heading.forward, isSelf, target);
    target.y -= STANDING_KNEE_SLACK;
    position.copy(target).sub(solved.position.head);
    return;
  }
  position.set(headsetPosition.x, headsetPosition.y - rig.lengths.hipsToHead - HEAD_BELOW_HEADSET, headsetPosition.z);
  if (isSelf) position.addScaledVector(heading.forward, -SELF_BACK_OFFSET);
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
  const name = ARM_BONES[side].hand;
  if (!rest[name]) return;
  const input = side === "left" ? pose.leftHand : pose.rightHand;

  if (rig.isHalfBody) {
    // The hands hang from the spine without arms: placed and turned from the controllers, without smoothing
    controllerTarget(input, state.calibration, solved.position[name]);
    turnWithController(rig, solved, input, side);
    localPositionOf(rest, solved, name, out.position[name]);
    out.hasPosition[name] = true;
    return;
  }

  const arm = restArm(rest, side);
  if (!arm) {
    // A hand without an arm to carry it follows its parent and only turns with the controller
    followAncestor(rest, solved, name);
    turnWithController(rig, solved, input, side);
    return;
  }

  smoothHandTarget(state.vr.hands[side], controllerTarget(input, state.calibration, target), deltaSeconds);
  solveArmTo(rig, solved, side, arm, target, heading);
  turnWithController(rig, solved, input, side);
}

/**
 * Solves one avatar in VR for one frame. The root takes the rig transform as it is. The body's heading
 * trails the head's yaw; the spine distributes the head's turn, roll included, and the head lands on the
 * headset's orientation; the hips are placed so the eyes land on the headset, in the model's proportions
 * once the height is calibrated; the legs reach the planted feet and the arms the smoothed controllers.
 * Bones the model lacks are skipped. Nothing is allocated per frame.
 */
export function solveVrBody(
  rig: RigDescription,
  pose: TrackedPose,
  state: IkState,
  out: BoneWrites,
  frame: SolveFrame
) {
  const deltaSeconds = beginFrame(state, out, frame);
  if (deltaSeconds === null) return;
  const rest = state.frames;
  const solved = state.solved;
  const hips = rest.hips!;

  writeRoot(pose, out);
  const bodyYaw = updateBodyYaw(state.bodyYaw, pose.head.rot.y, deltaSeconds);
  setBodyHeading(rig, bodyYaw, heading);

  // The headset in the model's proportions
  if (rest.head) calibrateHeight(state.calibration, pose.head.pos.y, rigEyeHeight(rig, rest.head));
  headsetPosition.set(pose.head.pos.x, scaleHeight(state.calibration, pose.head.pos.y), pose.head.pos.z);

  // The hips and the chain above them
  solved.quaternion.hips.copy(hips.quaternion).premultiply(heading.bodyDelta);
  solved.solved.hips = true;
  angles.pitch = pose.head.rot.x;
  angles.yaw = wrapAngle(pose.head.rot.y - bodyYaw);
  angles.roll = pose.head.rot.z;
  solveSpineChain(rest, solved, heading.body, heading.facing, angles, true);
  placeHips(rig, rest, solved, frame.isSelf);
  writeHips(rest, solved, out);
  followChain(rest, solved);

  const sitting = pose.animState === AvatarAnimState.SIT;
  solvePlantedLeg(rig, rest, solved, state.vr.feet, heading, sitting, "left");
  solvePlantedLeg(rig, rest, solved, state.vr.feet, heading, sitting, "right");
  solveArm(rig, rest, solved, state, pose, out, deltaSeconds, "left");
  solveArm(rig, rest, solved, state, pose, out, deltaSeconds, "right");

  writeSolvedRotations(rest, solved, out);
}
