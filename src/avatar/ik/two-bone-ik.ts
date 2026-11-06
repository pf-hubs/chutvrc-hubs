import { Quaternion, Vector3 } from "three";

/** A limb of two bones in root space: the joint between them is placed by hand, from the lengths alone */
export type TwoBoneInput = {
  /** Where the limb starts: the shoulder or the hip joint */
  root: Vector3;
  target: Vector3;
  /** The side the middle joint should be on, seen from the line between the root and the target */
  pole: Vector3;
  upperLength: number;
  lowerLength: number;
  /** The rest directions of the two bones, unit vectors in root space */
  restUpper: Vector3;
  restLower: Vector3;
  /** The side the middle joint bends toward in the rest pose, so the rest limb can be matched to the solved one */
  restBend: Vector3;
};

export type TwoBoneOutput = {
  joint: Vector3;
  /** Where the limb ends: the target, or the nearest point the limb reaches */
  end: Vector3;
  /** Rotations in root space that take each bone from its rest orientation to the solved one */
  upperDelta: Quaternion;
  lowerDelta: Quaternion;
};

export function createTwoBoneOutput(): TwoBoneOutput {
  return { joint: new Vector3(), end: new Vector3(), upperDelta: new Quaternion(), lowerDelta: new Quaternion() };
}

const EPSILON = 1e-6;
const UP = new Vector3(0, 1, 0);
const RIGHT = new Vector3(1, 0, 0);

const direction = new Vector3();
const bend = new Vector3();
const upperDirection = new Vector3();
const lowerDirection = new Vector3();
const restBendPerpendicular = new Vector3();
const restNormal = new Vector3();
const solvedNormal = new Vector3();
const turnedNormal = new Vector3();
const normalCross = new Vector3();
const turnedLower = new Vector3();
const twist = new Quaternion();

/** The part of `vector` perpendicular to the unit vector `axis`, written into `out` */
function perpendicularPart(vector: Vector3, axis: Vector3, out: Vector3): Vector3 {
  return out.copy(vector).addScaledVector(axis, -vector.dot(axis));
}

/** A unit vector perpendicular to the unit vector `axis`: the one that keeps the most of `preferred` if it can */
function perpendicularUnit(preferred: Vector3, axis: Vector3, out: Vector3): Vector3 {
  perpendicularPart(preferred, axis, out);
  if (out.lengthSq() > EPSILON) return out.normalize();
  out.crossVectors(axis, UP);
  if (out.lengthSq() > EPSILON) return out.normalize();
  return out.crossVectors(axis, RIGHT).normalize();
}

/**
 * The rotation that takes the frame (fromDirection, fromNormal) onto (toDirection, toNormal): first the
 * shortest turn between the directions, then a twist about the new direction that lines up the normals.
 * All four are unit vectors and each normal is perpendicular to its direction.
 */
function frameRotation(
  fromDirection: Vector3,
  fromNormal: Vector3,
  toDirection: Vector3,
  toNormal: Vector3,
  out: Quaternion
): Quaternion {
  out.setFromUnitVectors(fromDirection, toDirection);
  turnedNormal.copy(fromNormal).applyQuaternion(out);
  const sine = normalCross.crossVectors(turnedNormal, toNormal).dot(toDirection);
  const cosine = turnedNormal.dot(toNormal);
  twist.setFromAxisAngle(toDirection, Math.atan2(sine, cosine));
  return out.premultiply(twist);
}

/**
 * Solves the limb. The target is reached exactly when it lies between the folded and the stretched length
 * of the limb; beyond that the limb points at it stretched, and closer than that it folds as far as it
 * can. The middle joint goes to the pole's side of the root-to-target line; when the pole lies on that
 * line, the rest bend side is used, and failing that any perpendicular, so the result is always finite.
 * The lower bone turns about the bend plane's normal only, as a hinge on the solved upper bone.
 */
export function solveTwoBone(input: TwoBoneInput, out: TwoBoneOutput) {
  const { upperLength, lowerLength } = input;
  const total = upperLength + lowerLength;

  direction.subVectors(input.target, input.root);
  let distance = direction.length();
  if (distance > EPSILON) {
    direction.divideScalar(distance);
  } else {
    direction.copy(input.restUpper);
    distance = 0;
  }
  const reach = Math.max(Math.min(Math.max(distance, Math.abs(upperLength - lowerLength)), total), 1e-4);

  perpendicularPart(input.pole, direction, bend);
  if (bend.lengthSq() <= EPSILON) perpendicularUnit(input.restBend, direction, bend);
  else bend.normalize();

  const cosine = Math.min(
    1,
    Math.max(
      -1,
      (upperLength * upperLength + reach * reach - lowerLength * lowerLength) /
        (2 * Math.max(upperLength, EPSILON) * reach)
    )
  );
  const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
  out.joint
    .copy(input.root)
    .addScaledVector(direction, upperLength * cosine)
    .addScaledVector(bend, upperLength * sine);
  out.end.copy(input.root).addScaledVector(direction, reach);

  upperDirection.subVectors(out.joint, input.root).normalize();
  lowerDirection.subVectors(out.end, out.joint);
  if (lowerDirection.lengthSq() > EPSILON) lowerDirection.normalize();
  else lowerDirection.copy(upperDirection);

  // The normals of the bend plane before and after, matched so the rest bend side ends up on the pole side
  perpendicularUnit(input.restBend, input.restUpper, restBendPerpendicular);
  restNormal.crossVectors(input.restUpper, restBendPerpendicular).normalize();
  solvedNormal.crossVectors(direction, bend).normalize();
  frameRotation(input.restUpper, restNormal, upperDirection, solvedNormal, out.upperDelta);

  turnedLower.copy(input.restLower).applyQuaternion(out.upperDelta);
  out.lowerDelta.setFromUnitVectors(turnedLower, lowerDirection).multiply(out.upperDelta);
}
