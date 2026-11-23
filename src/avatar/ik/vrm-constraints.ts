import { Matrix4, Quaternion, Vector3 } from "three";
import { VrmConstraint } from "../rig/vrm-constraints";

/**
 * Evaluates the node constraints of a VRM 1.0 model (rig/vrm-constraints.ts) after a solver has written
 * the humanoid bones, following the VRM 1.0 specification of VRMC_node_constraint as three-vrm implements
 * it. Each destination's local rotation is set from its source and its local matrix is updated; the caller
 * updates the world matrices below the root afterwards. Nothing is allocated per frame.
 */

/** A direction shorter than this is not one: the destination then keeps its rest rotation */
const MIN_LENGTH = 1e-8;

const target = new Quaternion();
const delta = new Quaternion();
const parentWorld = new Quaternion();
const parentWorldInverse = new Quaternion();
const turnedAxis = new Vector3();
const restAxis = new Vector3();
const toSource = new Vector3();
const destinationPosition = new Vector3();
const rotationOnly = new Matrix4();

/** The destination takes the source's turn from its rest pose, as a turn of its own from its rest pose */
function rotationTarget(constraint: VrmConstraint, out: Quaternion): boolean {
  delta.copy(constraint.sourceRestInverse).multiply(constraint.source.quaternion);
  out.copy(constraint.destinationRest).multiply(delta);
  return true;
}

/** The destination takes the part of the source's turn that goes about the roll axis */
function rollTarget(constraint: VrmConstraint, out: Quaternion): boolean {
  // The source's turn from its rest pose, in its parent's frame, seen from the destination's own frame
  delta
    .copy(constraint.destinationRest)
    .invert()
    .multiply(constraint.source.quaternion)
    .multiply(constraint.sourceRestInverse)
    .multiply(constraint.destinationRest);
  // What is left of that turn once the swing it gives the roll axis is taken back is the roll itself
  turnedAxis.copy(constraint.axis).applyQuaternion(delta);
  out.setFromUnitVectors(turnedAxis, constraint.axis).premultiply(constraint.destinationRest).multiply(delta);
  return true;
}

/** The destination turns from its rest pose so that its aim axis points at the source */
function aimTarget(constraint: VrmConstraint, out: Quaternion): boolean {
  const { destination, source } = constraint;
  const parent = destination.parent;
  source.updateWorldMatrix(true, false);
  if (parent) {
    parent.updateWorldMatrix(true, false);
    parentWorld.setFromRotationMatrix(rotationOnly.extractRotation(parent.matrixWorld));
    destinationPosition.copy(destination.position).applyMatrix4(parent.matrixWorld);
  } else {
    parentWorld.identity();
    destinationPosition.copy(destination.position);
  }
  parentWorldInverse.copy(parentWorld).invert();

  toSource.setFromMatrixPosition(source.matrixWorld).sub(destinationPosition);
  if (toSource.lengthSq() < MIN_LENGTH * MIN_LENGTH) return false;
  toSource.normalize();
  // Where the aim axis points in the rest pose, carried by the parent as it is now
  restAxis.copy(constraint.axis).applyQuaternion(constraint.destinationRest).applyQuaternion(parentWorld);
  out
    .setFromUnitVectors(restAxis, toSource)
    .premultiply(parentWorldInverse)
    .multiply(parentWorld)
    .multiply(constraint.destinationRest);
  return true;
}

/** Applies the constraints in the order given, which is the order readVrmConstraints put them in */
export function applyVrmConstraints(constraints: readonly VrmConstraint[]) {
  for (let i = 0; i < constraints.length; i++) {
    const constraint = constraints[i];
    let found: boolean;
    switch (constraint.kind) {
      case "roll":
        found = rollTarget(constraint, target);
        break;
      case "aim":
        found = aimTarget(constraint, target);
        break;
      default:
        found = rotationTarget(constraint, target);
    }
    const destination = constraint.destination;
    destination.quaternion.copy(constraint.destinationRest);
    if (found) destination.quaternion.slerp(target, constraint.weight);
    destination.updateMatrix();
  }
}
