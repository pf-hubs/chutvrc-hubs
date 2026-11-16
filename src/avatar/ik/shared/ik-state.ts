import { Vector3 } from "three";
import { BodyYawState, createBodyYawState } from "./body-yaw";
import { createFootPlacement, FootPlacement } from "./feet";
import { createSolvedFrames, RestFrames, SolvedFrames } from "./rig-frames";

export type Side = "left" | "right";

/** A hand target smoothed over time, as the old solver smoothed the controller positions */
export type SmoothedTarget = { position: Vector3; valid: boolean };

/**
 * The solver a pose is solved with: a headset in VR, a screen (desktop, phone, tablet or bot), or the
 * chatbot.
 */
export type SolverKind = "vr" | "screen" | "npc";

/** What the VR solver keeps between frames: the planted feet and the smoothed hand targets */
export type VrSolverState = { feet: Record<Side, FootPlacement>; hands: Record<Side, SmoothedTarget> };

/** What the screen solver keeps between frames: the planted feet */
export type ScreenSolverState = { feet: Record<Side, FootPlacement> };

/** What the chatbot's solver keeps between frames: the smoothed hand targets; its feet are not planted */
export type NpcSolverState = { hands: Record<Side, SmoothedTarget> };

/**
 * What the solvers keep between frames for one avatar. The rest pose, the scratch solved frames, the body's
 * heading and the clock are shared, so a client that moves between VR and a screen keeps its heading; each
 * solver's own part is reset when the avatar enters that solver (see solve-body.ts).
 */
export type IkState = {
  frames: RestFrames;
  solved: SolvedFrames;
  /**
   * The size the model was drawn at in the last frame over its own size: the VR solver's ratio, the sender's
   * announced eye height over the model's (SolveFrame.modelRatio); 1 for the screen and chatbot solvers.
   * The root bone is scaled by it, so a position in root space is this many room metres per model metre.
   */
  modelRatio: number;
  bodyYaw: BodyYawState;
  /** When the last frame was solved, in milliseconds; 0 before the first */
  lastNow: number;
  /** The solver of the last frame; null before the first */
  solver: SolverKind | null;
  vr: VrSolverState;
  screen: ScreenSolverState;
  npc: NpcSolverState;
};

/**
 * What a frame adds to the pose: its time, whether the avatar is the own one, and for the VR solver the size
 * to draw the model at over its own size (the sender's announced standing eye height over the eye height of
 * the model this observer loaded, within 0.3 to 2.0; see modelRatioOf in calibration/body-calibration.ts).
 * A ratio that is missing or not a positive number is taken as 1, the model's own size.
 */
export type SolveFrame = { now: number; isSelf: boolean; modelRatio?: number };

function createFeet(): Record<Side, FootPlacement> {
  return { left: createFootPlacement(), right: createFootPlacement() };
}

function createHands(): Record<Side, SmoothedTarget> {
  return { left: { position: new Vector3(), valid: false }, right: { position: new Vector3(), valid: false } };
}

export function createIkState(frames: RestFrames): IkState {
  return {
    frames,
    solved: createSolvedFrames(),
    modelRatio: 1,
    bodyYaw: createBodyYawState(),
    lastNow: 0,
    solver: null,
    vr: { feet: createFeet(), hands: createHands() },
    screen: { feet: createFeet() },
    npc: { hands: createHands() }
  };
}

function resetFoot(foot: FootPlacement) {
  foot.position.set(0, 0, 0);
  foot.planted = false;
}

function resetHand(hand: SmoothedTarget) {
  hand.position.set(0, 0, 0);
  hand.valid = false;
}

/**
 * Brings a solver's own state back to how it starts: the feet are planted afresh where the body stands and
 * the hands snap to their targets, instead of continuing from where they were when the avatar last left
 * that solver.
 */
export function resetSolverState(state: IkState, solver: SolverKind) {
  switch (solver) {
    case "vr":
      resetFoot(state.vr.feet.left);
      resetFoot(state.vr.feet.right);
      resetHand(state.vr.hands.left);
      resetHand(state.vr.hands.right);
      break;
    case "screen":
      resetFoot(state.screen.feet.left);
      resetFoot(state.screen.feet.right);
      break;
    case "npc":
      resetHand(state.npc.hands.left);
      resetHand(state.npc.hands.right);
      break;
  }
}
