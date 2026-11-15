import { Vector3 } from "three";
import { TrackedPose } from "../../pose/tracked-pose";
import { RigDescription } from "../../rig/rig-description";
import { AvatarAnimState } from "../../../types/avatar-types";
import { updateBodyYaw, wrapAngle } from "../shared/body-yaw";
import {
  BodyHeading,
  beginFrame,
  createBodyHeading,
  followChain,
  setBodyHeading,
  writeHips,
  writeRoot,
  writeSolvedRotations
} from "../shared/body-frame";
import { BoneWrites } from "../shared/bone-writes";
import { SELF_BACK_OFFSET } from "../shared/head";
import { IkState, Side, SolveFrame } from "../shared/ik-state";
import { ARM_BONES, restArm, solveArmTo, solvePlantedLeg } from "../shared/limbs";
import { followAncestor, RestFrames, SolvedFrames } from "../shared/rig-frames";
import { ChainAngles, solveSpineChain } from "../shared/spine-chain";

/**
 * The screen solver, for a pose without a presenting headset: a desktop, a phone, a tablet or a bot. It
 * reads the head's orientation and the rig only. The hips rest at their rest height under the rig, the
 * arms hang at the sides, the feet stand on the floor, and the model keeps its own size whatever height
 * its sender announces.
 */

/** A screen user's arms hang at the sides, slightly forward and bent, in fractions of the arm's length */
const RELAXED_ARM_DOWN = 0.93;
const RELAXED_ARM_FORWARD = 0.12;
const RELAXED_ARM_OUT = 0.1;

const UP = new Vector3(0, 1, 0);

const heading: BodyHeading = createBodyHeading();
const target = new Vector3();
const angles: ChainAngles = { pitch: 0, yaw: 0, roll: 0 };

function solveArm(rig: RigDescription, rest: RestFrames, solved: SolvedFrames, out: BoneWrites, side: Side) {
  const name = ARM_BONES[side].hand;
  const hand = rest[name];
  if (!hand) return;

  if (rig.isHalfBody) {
    // The hands of an upper body hang from the spine; without controllers to place them they are hidden
    out.handsHidden = true;
    return;
  }

  const arm = restArm(rest, side);
  if (!arm) {
    // A hand without an arm to carry it follows its parent
    followAncestor(rest, solved, name);
    return;
  }

  const shoulder = solved.position[ARM_BONES[side].upper];
  const armLength = arm.upperLength + arm.lowerLength;
  const outward = side === "left" ? -1 : 1;
  target
    .copy(shoulder)
    .addScaledVector(UP, -RELAXED_ARM_DOWN * armLength)
    .addScaledVector(heading.forward, RELAXED_ARM_FORWARD * armLength)
    .addScaledVector(heading.right, outward * RELAXED_ARM_OUT * armLength);
  const turns = solveArmTo(rig, solved, side, arm, target, heading);
  // Without a controller the hand keeps its rest pose on the forearm
  solved.quaternion[name].copy(hand.quaternion).premultiply(turns.lowerDelta);
  solved.solved[name] = true;
}

/**
 * Solves one avatar on a screen for one frame. The root takes the rig transform as it is. The body's
 * heading trails the head's yaw; the spine distributes the head's pitch and yaw, without roll, and the
 * head lands on that orientation; the hips stay at their rest height under the rig's origin (the own
 * avatar a step back); the legs reach the planted feet and the arms hang. Bones the model lacks are
 * skipped. Nothing is allocated per frame.
 */
export function solveScreenBody(
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

  // The hips and the chain above them
  solved.quaternion.hips.copy(hips.quaternion).premultiply(heading.bodyDelta);
  solved.solved.hips = true;
  angles.pitch = pose.head.rot.x;
  angles.yaw = wrapAngle(pose.head.rot.y - bodyYaw);
  angles.roll = 0;
  solveSpineChain(rest, solved, heading.body, heading.facing, angles, true);
  solved.position.hips.set(0, hips.position.y, 0);
  if (frame.isSelf) solved.position.hips.addScaledVector(heading.forward, -SELF_BACK_OFFSET);
  writeHips(rest, solved, out);
  followChain(rest, solved);

  const sitting = pose.animState === AvatarAnimState.SIT;
  solvePlantedLeg(rig, rest, solved, state.screen.feet, heading, sitting, "left");
  solvePlantedLeg(rig, rest, solved, state.screen.feet, heading, sitting, "right");
  solveArm(rig, rest, solved, out, "left");
  solveArm(rig, rest, solved, out, "right");

  writeSolvedRotations(rest, solved, out);
}
