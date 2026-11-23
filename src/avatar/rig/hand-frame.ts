import { Matrix4, Object3D, Quaternion, Vector3 } from "three";

/**
 * A hand's own frame, measured from where its bones are in the rest pose. Rigs differ in how a hand bone's
 * axes lie in the hand, so a bone's orientation alone does not say where its fingers point or where its
 * palm faces; the positions of the finger bones do. The frame has
 *
 * - x along the fingers, from the wrist to the first bone of the middle finger,
 * - y out of the back of the hand,
 * - z = x × y, which is the little finger's side of a right hand and the thumb's side of a left hand.
 *
 * Pure: positions in, a rotation out.
 */

export type HandSide = "left" | "right";

/** The first bones of three fingers of one hand; null for a finger the model does not have or name */
export type FingerBones = { index: Object3D | null; middle: Object3D | null; little: Object3D | null };

/**
 * How the back of the hand was found: from the finger bones, or, for a hand without them, by taking the
 * palm to face down in the rest pose, as it does in a T-pose and an A-pose
 */
export type HandFrameSource = "fingers" | "rest pose";

/** Where the hand's joints are in the rest pose, all in one space; null for a joint the model lacks */
export type HandPoints = {
  wrist: Vector3;
  lowerArm: Vector3 | null;
  index: Vector3 | null;
  middle: Vector3 | null;
  little: Vector3 | null;
};

/** Shorter than this, a direction between two joints is not one */
const MIN_LENGTH = 1e-6;
/** A back of the hand closer than this to the finger direction (as a sine) says nothing about the palm */
const MIN_ACROSS = 1e-3;

const UP = new Vector3(0, 1, 0);
const fingers = new Vector3();
const back = new Vector3();
const across = new Vector3();
const toIndex = new Vector3();
const toLittle = new Vector3();
const basis = new Matrix4();

/** The direction the fingers point: to the middle finger, else between the index and little fingers, else along the forearm */
function fingerDirection(points: HandPoints, out: Vector3): boolean {
  if (points.middle && out.subVectors(points.middle, points.wrist).lengthSq() > MIN_LENGTH * MIN_LENGTH) {
    out.normalize();
    return true;
  }
  if (points.index && points.little) {
    out.addVectors(points.index, points.little).multiplyScalar(0.5).sub(points.wrist);
    if (out.lengthSq() > MIN_LENGTH * MIN_LENGTH) {
      out.normalize();
      return true;
    }
  }
  if (points.lowerArm && out.subVectors(points.wrist, points.lowerArm).lengthSq() > MIN_LENGTH * MIN_LENGTH) {
    out.normalize();
    return true;
  }
  return false;
}

/** Takes the part of `vector` along `axis` out of it and makes it a unit vector; false when nothing is left */
function makePerpendicular(vector: Vector3, axis: Vector3): boolean {
  vector.addScaledVector(axis, -vector.dot(axis));
  if (vector.lengthSq() < MIN_ACROSS * MIN_ACROSS) return false;
  vector.normalize();
  return true;
}

/**
 * Measures the hand's frame from its joints in the rest pose and writes it to `out` as the rotation that
 * turns the frame's axes (x fingers, y back of the hand, z = x × y) into the space the points are in.
 * `outward` is the direction away from the body's middle on this hand's side; it stands in for the back of
 * the hand when the fingers point straight up or down and the palm cannot be told otherwise. Returns how
 * the back of the hand was found, or null when the hand has no joint to tell its fingers' direction by.
 */
export function measureHandFrame(
  side: HandSide,
  points: HandPoints,
  outward: Vector3,
  out: Quaternion
): HandFrameSource | null {
  if (!fingerDirection(points, fingers)) return null;

  let source: HandFrameSource = "rest pose";
  let hasBack = false;
  if (points.index && points.little) {
    // From the wrist, the index and little fingers span the palm; which way their cross product points depends on the side
    toIndex.subVectors(points.index, points.wrist);
    toLittle.subVectors(points.little, points.wrist);
    if (side === "left") back.crossVectors(toIndex, toLittle);
    else back.crossVectors(toLittle, toIndex);
    if (back.lengthSq() > MIN_LENGTH * MIN_LENGTH * MIN_LENGTH * MIN_LENGTH) {
      back.normalize();
      hasBack = makePerpendicular(back, fingers);
      if (hasBack) source = "fingers";
    }
  }
  if (!hasBack) hasBack = makePerpendicular(back.copy(UP), fingers);
  if (!hasBack) hasBack = makePerpendicular(back.copy(outward), fingers);
  if (!hasBack) return null;

  across.crossVectors(fingers, back);
  out.setFromRotationMatrix(basis.makeBasis(fingers, back, across));
  return source;
}

/** Keywords in a finger bone's name, lower-cased */
const FINGER_KEYWORDS: Readonly<Record<keyof FingerBones, readonly string[]>> = {
  index: ["index"],
  middle: ["middle"],
  little: ["little", "pinky", "pinkie"]
};
/** How far below the hand a finger's first bone is looked for */
const MAX_FINGER_DEPTH = 3;

/**
 * Finds the first bones of the index, middle and little fingers below a hand by keywords in the object
 * names: of the objects named like a finger, the one nearest to the hand in the hierarchy.
 */
export function mapFingerBonesByKeywords(hand: Object3D): FingerBones {
  const found: FingerBones = { index: null, middle: null, little: null };
  let level: Object3D[] = hand.children;
  for (let depth = 1; depth <= MAX_FINGER_DEPTH && level.length > 0; depth++) {
    const next: Object3D[] = [];
    for (const object of level) {
      const name = object.name.toLowerCase();
      for (const finger of Object.keys(FINGER_KEYWORDS) as (keyof FingerBones)[]) {
        if (!found[finger] && FINGER_KEYWORDS[finger].some(keyword => name.includes(keyword))) found[finger] = object;
      }
      next.push(...object.children);
    }
    level = next;
  }
  return found;
}
