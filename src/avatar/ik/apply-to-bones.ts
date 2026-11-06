import { Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { BODY_BONE_NAMES, BONE_NAMES, BoneName, boneRecord } from "../rig/bone-names";
import { RigDescription } from "../rig/rig-description";
import { RestFrame, RestFrames } from "./rig-frames";
import { BoneWrites, isPositionBone } from "./solve-body";

/**
 * The only module of the solver that touches the scene objects: it reads the rest pose of the bone
 * hierarchy once, and each frame writes the solved pose to the bones and updates their matrices once.
 */

/** The scale the old solver shrinks an upper-body model's hands to when they have no controller to follow */
const HIDDEN_HAND_SCALE = 0.1;

const localMatrix = new Matrix4();
const scale = new Vector3();

/**
 * Measures where each named bone sits in root space in the model's rest pose. The named bones take the
 * rest transform recorded when the model was loaded, since a solver may have posed them since; the
 * unnamed objects between them, which no solver moves, take their current transform. A bone that does
 * not hang below the root gets no frame and is treated as missing.
 */
export function readRestFrames(rig: RigDescription): RestFrames {
  const frames = boneRecord<RestFrame | null>(null);
  const root = rig.bones.root;
  if (!root) return frames;

  const nameOf = new Map<Object3D, BoneName>();
  for (const name of BONE_NAMES) {
    const bone = rig.bones[name];
    if (bone) nameOf.set(bone, name);
  }

  // Root space is the frame of the root's children: the root's own transform is the rig's, not the model's
  const matrices = new Map<Object3D, Matrix4>();
  matrices.set(root, new Matrix4());
  const restMatrixOf = (object: Object3D): Matrix4 | null => {
    const known = matrices.get(object);
    if (known) return known;
    if (!object.parent) return null;
    const parentMatrix = restMatrixOf(object.parent);
    if (!parentMatrix) return null;
    const name = nameOf.get(object);
    const rest = name ? rig.rest[name] : null;
    if (rest) localMatrix.compose(rest.position, rest.quaternion, object.scale);
    else localMatrix.compose(object.position, object.quaternion, object.scale);
    const matrix = new Matrix4().multiplyMatrices(parentMatrix, localMatrix);
    matrices.set(object, matrix);
    return matrix;
  };
  const ancestorOf = (object: Object3D): BoneName | null => {
    for (let parent = object.parent; parent; parent = parent.parent) {
      const name = nameOf.get(parent);
      if (name) return name;
    }
    return null;
  };

  frames.root = {
    position: new Vector3(),
    quaternion: new Quaternion(),
    ancestor: null,
    parentPosition: new Vector3(),
    parentQuaternion: new Quaternion()
  };
  for (const name of BONE_NAMES) {
    const bone = rig.bones[name];
    if (!bone || name === "root" || !bone.parent) continue;
    const matrix = restMatrixOf(bone);
    const parentMatrix = restMatrixOf(bone.parent);
    if (!matrix || !parentMatrix) continue;
    const frame: RestFrame = {
      position: new Vector3(),
      quaternion: new Quaternion(),
      ancestor: ancestorOf(bone),
      parentPosition: new Vector3(),
      parentQuaternion: new Quaternion()
    };
    matrix.decompose(frame.position, frame.quaternion, scale);
    parentMatrix.decompose(frame.parentPosition, frame.parentQuaternion, scale);
    frames[name] = frame;
  }
  return frames;
}

function setHandVisibility(hand: Object3D | null, hidden: boolean) {
  if (!hand) return;
  if (hidden) {
    hand.position.set(0, 0, 0);
    hand.scale.setScalar(HIDDEN_HAND_SCALE);
  } else {
    hand.scale.setScalar(1);
  }
  hand.updateMatrix();
}

/** Writes each solved rotation and position to its bone once, then updates the world matrices below the root once */
export function applyToBones(rig: RigDescription, writes: BoneWrites) {
  const root = rig.bones.root;
  if (!root) return;
  for (const name of BODY_BONE_NAMES) {
    const bone = rig.bones[name];
    if (!bone) continue;
    let changed = false;
    if (writes.hasRotation[name]) {
      bone.quaternion.copy(writes.rotation[name]);
      changed = true;
    }
    if (isPositionBone(name) && writes.hasPosition[name]) {
      bone.position.copy(writes.position[name]);
      changed = true;
    }
    if (changed) bone.updateMatrix();
  }
  if (writes.handsHidden) {
    setHandVisibility(rig.bones.leftHand, true);
    setHandVisibility(rig.bones.rightHand, true);
  } else {
    if (writes.hasPosition.leftHand) setHandVisibility(rig.bones.leftHand, false);
    if (writes.hasPosition.rightHand) setHandVisibility(rig.bones.rightHand, false);
  }
  root.updateWorldMatrix(false, true);
}
