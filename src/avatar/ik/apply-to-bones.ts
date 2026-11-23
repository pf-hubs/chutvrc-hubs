import { Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { BODY_BONE_NAMES, BONE_NAMES, BoneName, boneRecord } from "../rig/bone-names";
import { RigDescription } from "../rig/rig-description";
import { BoneWrites, isPositionBone } from "./shared/bone-writes";
import { RestFrame, RestFrames } from "./shared/rig-frames";

/**
 * The only module of the solver that touches the scene objects: it reads the rest pose of the bone
 * hierarchy once, and each frame writes the solved pose to the bones and updates their matrices once.
 */

/** The scale an upper-body model's hands are shrunk to while they have no controller to follow */
const HIDDEN_HAND_SCALE = 0.1;

/**
 * The scale a hidden head is shrunk to. Everything that hangs from the head bone, the face, the eyes and
 * the hair, shrinks into the top of the neck with it, while the neck, the shoulders and the body stay. Not
 * zero, which would leave the bones below it without an inverse.
 */
const HIDDEN_HEAD_SCALE = 0.0001;

const localMatrix = new Matrix4();
const scale = new Vector3();

/**
 * The scale each root had before a solver first wrote to it, so a model drawn at another size goes back to
 * its own. Recorded the first time the root's bones are written; no solver had changed it before then.
 */
const restRootScales = new WeakMap<Object3D, Vector3>();

/** The scale each head bone had before it was first hidden, to show it again at its own size */
const restHeadScales = new WeakMap<Object3D, Vector3>();

/** Shrinks the head bone to hide it, or gives it its own scale back; returns whether its scale changed */
function setHeadHidden(head: Object3D, hidden: boolean): boolean {
  let rest = restHeadScales.get(head);
  if (!rest) {
    // A head that was never hidden has its own scale
    if (!hidden) return false;
    rest = head.scale.clone();
    restHeadScales.set(head, rest);
  }
  const factor = hidden ? HIDDEN_HEAD_SCALE : 1;
  const x = rest.x * factor;
  if (head.scale.x === x) return false;
  head.scale.set(x, rest.y * factor, rest.z * factor);
  return true;
}

function restRootScaleOf(root: Object3D): Vector3 {
  let rest = restRootScales.get(root);
  if (!rest) {
    rest = root.scale.clone();
    restRootScales.set(root, rest);
  }
  return rest;
}

/** Sets the root's scale to its rest scale times `factor`; returns whether it changed */
function setRootScale(root: Object3D, factor: number): boolean {
  const rest = restRootScaleOf(root);
  const x = rest.x * factor;
  const y = rest.y * factor;
  const z = rest.z * factor;
  if (root.scale.x === x && root.scale.y === y && root.scale.z === z) return false;
  root.scale.set(x, y, z);
  return true;
}

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

/**
 * Writes each solved rotation and position to its bone once, the root's scale and the head's (shrunk to
 * hide it, its own otherwise), then updates the world matrices below the root once. A root scaled by the VR solver scales the whole model about the rig's
 * position, so the bones' world positions, which the name tag and the probes read, are where it is drawn.
 */
export function applyToBones(rig: RigDescription, writes: BoneWrites) {
  const root = rig.bones.root;
  if (!root) return;
  const rootScaled = setRootScale(root, writes.rootScale);
  const headScaled = rig.bones.head ? setHeadHidden(rig.bones.head, writes.headHidden) : false;
  for (const name of BODY_BONE_NAMES) {
    const bone = rig.bones[name];
    if (!bone) continue;
    let changed = (name === "root" && rootScaled) || (name === "head" && headScaled);
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
