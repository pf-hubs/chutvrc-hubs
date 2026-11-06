import { Quaternion, Vector3 } from "three";
import { BONE_NAMES, BoneName, boneRecord } from "../rig/bone-names";

/**
 * Where a bone sits in the rig's root space when the model is in its rest pose. Root space is the frame
 * the root bone's children are expressed in: the solver places the root itself from the rig transform,
 * so root space coincides with the rig's space and the tracked positions can be used in it as they are.
 */
export type RestFrame = {
  position: Vector3;
  quaternion: Quaternion;
  /** The nearest named bone above this one; the objects between the two never move, so they follow it */
  ancestor: BoneName | null;
  /** The rest frame of the object the bone hangs from, which is the ancestor or an unnamed node below it */
  parentPosition: Vector3;
  parentQuaternion: Quaternion;
};

export type RestFrames = Record<BoneName, RestFrame | null>;

/**
 * The solved pose of the named bones in root space. A bone the solver gives an orientation is marked
 * solved; any other bone keeps its rest orientation relative to its ancestor and moves with it.
 */
export type SolvedFrames = {
  position: Record<BoneName, Vector3>;
  quaternion: Record<BoneName, Quaternion>;
  solved: Record<BoneName, boolean>;
};

export function createSolvedFrames(): SolvedFrames {
  const position = boneRecord<Vector3>(null as unknown as Vector3);
  const quaternion = boneRecord<Quaternion>(null as unknown as Quaternion);
  for (const name of BONE_NAMES) {
    position[name] = new Vector3();
    quaternion[name] = new Quaternion();
  }
  return { position, quaternion, solved: boneRecord(false) };
}

export function clearSolvedFrames(frames: SolvedFrames) {
  for (const name of BONE_NAMES) {
    frames.position[name].set(0, 0, 0);
    frames.quaternion[name].identity();
    frames.solved[name] = false;
  }
}

const restInverse = new Quaternion();
const ancestorDelta = new Quaternion();
const offset = new Vector3();
const parentQuaternion = new Quaternion();
const parentPosition = new Vector3();

/** How far the bone has turned from its rest orientation, as a rotation in root space */
export function deltaOf(rest: RestFrames, solved: SolvedFrames, name: BoneName, out: Quaternion): Quaternion {
  const frame = rest[name];
  if (!frame) return out.identity();
  restInverse.copy(frame.quaternion).invert();
  return out.copy(solved.quaternion[name]).multiply(restInverse);
}

/**
 * Places the bone where its ancestor's motion carries it, and turns it with the ancestor unless it was
 * solved. The hips are placed by the solver, so they are skipped: their ancestor is the root.
 */
export function followAncestor(rest: RestFrames, solved: SolvedFrames, name: BoneName) {
  const frame = rest[name];
  if (!frame || !frame.ancestor) return;
  const ancestorFrame = rest[frame.ancestor];
  if (!ancestorFrame) return;
  deltaOf(rest, solved, frame.ancestor, ancestorDelta);
  offset.subVectors(frame.position, ancestorFrame.position).applyQuaternion(ancestorDelta);
  solved.position[name].copy(solved.position[frame.ancestor]).add(offset);
  if (!solved.solved[name]) solved.quaternion[name].copy(frame.quaternion).premultiply(ancestorDelta);
}

/** The solved frame of the object the bone hangs from: the ancestor's motion applied to the parent's rest frame */
function solvedParent(rest: RestFrames, solved: SolvedFrames, frame: RestFrame) {
  const ancestorFrame = frame.ancestor ? rest[frame.ancestor] : null;
  if (!frame.ancestor || !ancestorFrame) {
    parentQuaternion.copy(frame.parentQuaternion);
    parentPosition.copy(frame.parentPosition);
    return;
  }
  deltaOf(rest, solved, frame.ancestor, ancestorDelta);
  parentQuaternion.copy(frame.parentQuaternion).premultiply(ancestorDelta);
  offset.subVectors(frame.parentPosition, ancestorFrame.position).applyQuaternion(ancestorDelta);
  parentPosition.copy(solved.position[frame.ancestor]).add(offset);
}

/** The bone's solved orientation as the local rotation its object needs */
export function localRotationOf(rest: RestFrames, solved: SolvedFrames, name: BoneName, out: Quaternion): Quaternion {
  const frame = rest[name];
  if (!frame) return out.identity();
  solvedParent(rest, solved, frame);
  return out.copy(parentQuaternion).invert().multiply(solved.quaternion[name]);
}

/** The bone's solved position as the local position its object needs; bone scales are taken as one */
export function localPositionOf(rest: RestFrames, solved: SolvedFrames, name: BoneName, out: Vector3): Vector3 {
  const frame = rest[name];
  if (!frame) return out.set(0, 0, 0);
  solvedParent(rest, solved, frame);
  return out.copy(solved.position[name]).sub(parentPosition).applyQuaternion(parentQuaternion.invert());
}
