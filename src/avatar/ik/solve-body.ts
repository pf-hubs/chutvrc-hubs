import { TrackedPose } from "../pose/tracked-pose";
import { RigDescription } from "../rig/rig-description";
import { solveNpcBody } from "./npc/solve-npc-body";
import { solveScreenBody } from "./screen/solve-screen-body";
import { BoneWrites } from "./shared/bone-writes";
import { IkState, resetSolverState, SolveFrame, SolverKind } from "./shared/ik-state";
import { solveVrBody } from "./vr/solve-vr-body";

export type { BoneWrites, PositionBoneName } from "./shared/bone-writes";
export { createBoneWrites, isPositionBone } from "./shared/bone-writes";
export type { IkState, SolveFrame, SolverKind } from "./shared/ik-state";
export { createIkState } from "./shared/ik-state";

/**
 * The body solver: pure functions over the rig description and a tracked pose. They work in root space,
 * the rig's space, where the tracked head and controllers are already expressed, and leave the scene
 * objects to apply-to-bones. There is one solver per kind of sender, each in its own folder:
 *
 * - vr/: a headset that is presenting, with its controllers;
 * - screen/: a desktop, a phone, a tablet or a bot, which give the head's orientation and the rig only;
 * - npc/: the chatbot, which gives a head position and hand targets in its own way.
 *
 * What they share (the two-bone limbs, the spine chain, the body's heading, the feet, the rest and solved
 * frames, the bone writes and the state kept between frames) is in shared/.
 */

/** The solver a pose is solved with: the chatbot's for a pose it writes, the VR one while the headset presents */
export function solverKindOf(pose: TrackedPose): SolverKind {
  if (pose.isNPC) return "npc";
  return pose.isVR ? "vr" : "screen";
}

/**
 * Solves one avatar for one frame with the solver its pose calls for. The avatar keeps one state across
 * the solvers: the body's heading and the clock carry over, while the planted feet and the smoothed hands
 * of the solver it enters start afresh, so a client that moves between VR and a screen does not continue
 * from where its feet and hands were when it last left that solver. Only the VR solver draws the model at
 * another size than its own (frame.modelRatio); the screen and chatbot solvers draw it at its own size, and
 * a root the VR solver scaled is brought back by their bone writes. Nothing is allocated per frame.
 */
export function solveBody(rig: RigDescription, pose: TrackedPose, state: IkState, out: BoneWrites, frame: SolveFrame) {
  const kind = solverKindOf(pose);
  if (state.solver !== kind) {
    resetSolverState(state, kind);
    state.solver = kind;
  }
  switch (kind) {
    case "vr":
      solveVrBody(rig, pose, state, out, frame);
      break;
    case "screen":
      state.modelRatio = 1;
      solveScreenBody(rig, pose, state, out, frame);
      break;
    case "npc":
      state.modelRatio = 1;
      solveNpcBody(rig, pose, state, out, frame);
      break;
  }
}
