import { Euler, Quaternion, Vector3 } from "three";
import { TrackedPose } from "../../pose/tracked-pose";
import { RigDescription } from "../../rig/rig-description";
import {
  BodyHeading,
  beginFrame,
  createBodyHeading,
  followChain,
  setBodyHeading,
  writeSolvedRotations
} from "../shared/body-frame";
import { BoneWrites } from "../shared/bone-writes";
import { standingFootTarget } from "../shared/feet";
import { facingYaw } from "../shared/head";
import { IkState, Side, SolveFrame } from "../shared/ik-state";
import { ARM_BONES, LEG_BONES, restArm, restLeg, smoothHandTarget, solveArmTo, solveLegTo } from "../shared/limbs";
import { followAncestor, RestFrames, SolvedFrames } from "../shared/rig-frames";
import { ChainAngles, solveSpineChain } from "../shared/spine-chain";

/**
 * The chatbot's solver, the path the chatbot's avatar has always taken: it keeps the root and hips it was
 * given and the old solver's gates. Its head is not turned; the chain leans toward the head's position;
 * the feet stand at their rest spots without planting and the hands reach the given targets, smoothed,
 * neither turned. The chatbot's heights are used as they are.
 */

const EPSILON = 1e-8;

const heading: BodyHeading = createBodyHeading();
const euler = new Euler();
const aim = new Quaternion();
const bodyInverse = new Quaternion();
const headPosition = new Vector3();
const target = new Vector3();
const restOffset = new Vector3();
const restUp = new Vector3();
const toTarget = new Vector3();
const angles: ChainAngles = { pitch: 0, yaw: 0, roll: 0 };

/**
 * The angles the chain distributes: the chatbot gives the head a position to lean toward rather than an
 * orientation, so the chain bends toward it without twisting, as the old solver aimed it.
 */
function chainAngles(rest: RestFrames, out: ChainAngles) {
  out.pitch = 0;
  out.yaw = 0;
  out.roll = 0;
  const head = rest.head;
  const hips = rest.hips;
  if (!head || !hips) return;
  restUp.subVectors(head.position, hips.position);
  toTarget.subVectors(headPosition, hips.position);
  if (restUp.lengthSq() < EPSILON || toTarget.lengthSq() < EPSILON) return;
  aim.setFromUnitVectors(restUp.normalize(), toTarget.normalize());
  aim.premultiply(bodyInverse.copy(heading.body).invert()).multiply(heading.body);
  euler.setFromQuaternion(aim, "YXZ");
  out.pitch = euler.x;
  out.roll = euler.z;
}

/** A leg reaching the foot's rest spot under the hips, not planted; the foot follows the shin */
function solveLeg(rig: RigDescription, rest: RestFrames, solved: SolvedFrames, side: Side) {
  const leg = restLeg(rest, side);
  if (!leg) return;
  restOffset.subVectors(leg.end.position, rest.hips!.position);
  standingFootTarget(solved.position.hips, heading.bodyDelta, restOffset, leg.end.position.y, target);
  solveLegTo(rig, solved, side, leg, target, heading);
  followAncestor(rest, solved, LEG_BONES[side].foot);
}

/** An arm reaching the given hand target, smoothed; the hand follows the forearm */
function solveArm(
  rig: RigDescription,
  rest: RestFrames,
  solved: SolvedFrames,
  state: IkState,
  pose: TrackedPose,
  deltaSeconds: number,
  side: Side
) {
  const name = ARM_BONES[side].hand;
  if (!rest[name]) return;
  // An upper body's hands are left where they hang
  if (rig.isHalfBody) return;

  const arm = restArm(rest, side);
  if (!arm) {
    followAncestor(rest, solved, name);
    return;
  }

  const input = side === "left" ? pose.leftHand : pose.rightHand;
  target.set(input.pos.x, input.pos.y, input.pos.z);
  smoothHandTarget(state.npc.hands[side], target, deltaSeconds);
  solveArmTo(rig, solved, side, arm, target, heading);
  followAncestor(rest, solved, name);
}

/**
 * Solves the chatbot's avatar for one frame. The root and the hips keep the transforms the chatbot's
 * scene gave them, the body its rest heading; the chain leans toward the head's position, the legs reach
 * the feet's rest spots and the arms the given hand targets. Bones the model lacks are skipped. Nothing
 * is allocated per frame.
 */
export function solveNpcBody(
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

  // The rest heading, which the facing yaw brings to zero
  setBodyHeading(rig, -facingYaw(rig.forward), heading);
  headPosition.set(pose.head.pos.x, pose.head.pos.y, pose.head.pos.z);

  // The hips keep their rest pose; the chain above them leans, the head follows it
  solved.quaternion.hips.copy(hips.quaternion).premultiply(heading.bodyDelta);
  solved.solved.hips = false;
  chainAngles(rest, angles);
  solveSpineChain(rest, solved, heading.body, heading.facing, angles, false);
  solved.position.hips.copy(hips.position);
  followChain(rest, solved);

  solveLeg(rig, rest, solved, "left");
  solveLeg(rig, rest, solved, "right");
  solveArm(rig, rest, solved, state, pose, deltaSeconds, "left");
  solveArm(rig, rest, solved, state, pose, deltaSeconds, "right");

  writeSolvedRotations(rest, solved, out);
}
