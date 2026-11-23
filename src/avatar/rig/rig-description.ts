import { Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { BONE_NAMES, BoneName, boneRecord } from "./bone-names";
import { mapBonesByKeywords } from "./bone-map-keywords";
import { LoadedGltf, mapBonesFromVrm, mapFingerBonesFromVrm } from "./bone-map-vrm";
import {
  FingerBones,
  HandFrameSource,
  HandPoints,
  HandSide,
  mapFingerBonesByKeywords,
  measureHandFrame
} from "./hand-frame";

/** Which mapping found the bones: the VRM humanoid extension, or keywords in the object names */
export type RigSource = "vrm" | "keywords";

/** A bone's local position and rotation when the model was loaded */
export type RestPose = { position: Vector3; quaternion: Quaternion };

/** Lengths of one side's limbs: the distance between a bone and the next one down, null when one is missing */
export type LimbLengths = {
  upperArm: number | null;
  forearm: number | null;
  upperLeg: number | null;
  lowerLeg: number | null;
};

/**
 * One hand as it was measured in the rest pose (hand-frame.ts): the turn from the hand's own frame (x
 * along the fingers, y out of the back of the hand) to the hand bone's rest orientation, both in root
 * space. A solver that knows where the fingers and the back of the hand should point gets the bone's
 * orientation by turning that frame by this offset, whatever axes the rig gave the bone.
 */
export type HandDescription = { boneOffset: Quaternion; source: HandFrameSource };

/**
 * What a solver needs to know about one loaded model, measured once when the model was loaded and in its
 * rest pose: the bones, their rest pose, the way the model faces and how long its parts are.
 */
export type RigDescription = {
  source: RigSource;
  bones: Record<BoneName, Object3D | null>;
  /** The rest pose of each bone, null for a bone the model lacks */
  rest: Record<BoneName, RestPose | null>;
  /** The direction the rest pose faces, in the root's space, without a vertical part */
  forward: Vector3;
  lengths: {
    /**
     * The head's height above the hips in the rest pose, in world units. It is the value the solver has
     * always placed the hips with, including its fallbacks for a missing head (1) or hips (0).
     */
    hipsToHead: number;
    left: LimbLengths;
    right: LimbLengths;
  };
  /** The midpoint of the eyes seen from the head: in the head's orientation at world scale; null without eye bones */
  eyeOffsetFromHead: Vector3 | null;
  /** The solver's sign for a model that faces -z: the right hand's local x is greater than the left hand's */
  isFlippedY: boolean;
  /** A model whose hands hang from the spine and the spine from the hips: an upper body without arms */
  isHalfBody: boolean;
  /** Each hand as measured in the rest pose; null for a hand the model lacks or that has nothing to measure it by */
  hands: Record<HandSide, HandDescription | null>;
};

const worldPositionA = new Vector3();
const worldPositionB = new Vector3();

function distanceBetween(a: Object3D | null, b: Object3D | null): number | null {
  if (!a || !b) return null;
  return a.getWorldPosition(worldPositionA).distanceTo(b.getWorldPosition(worldPositionB));
}

/** The head's height above the hips, computed as the solver computed it */
function measureHipsToHead(hips: Object3D | null, head: Object3D | null): number {
  const headWorldPos = new Vector3();
  const hipsWorldPos = new Vector3();
  head?.getWorldPosition(headWorldPos);
  hips?.getWorldPosition(hipsWorldPos);
  return (headWorldPos.y || 1) - (hipsWorldPos.y || 0);
}

/**
 * The direction the model faces in the root's space, from where the hands (or the upper arms) are: the
 * side the right hand is on, turned a quarter around the vertical. Falls back to the axis the solver's
 * flipped flag stands for when the bones are missing or lie on one vertical line.
 */
function measureForward(bones: Record<BoneName, Object3D | null>, isFlippedY: boolean): Vector3 {
  const forward = new Vector3(0, 0, isFlippedY ? -1 : 1);
  const root = bones.root;
  const left = bones.leftHand ?? bones.leftUpperArm;
  const right = bones.rightHand ?? bones.rightUpperArm;
  if (!root || !left || !right) return forward;

  const leftPosition = left.getWorldPosition(new Vector3());
  const rightPosition = right.getWorldPosition(new Vector3());
  root.updateWorldMatrix(true, false);
  const worldToRoot = new Matrix4().copy(root.matrixWorld).invert();
  const across = rightPosition.applyMatrix4(worldToRoot).sub(leftPosition.applyMatrix4(worldToRoot));
  const facing = new Vector3(across.z, 0, -across.x);
  if (facing.lengthSq() < 1e-8) return forward;
  return facing.normalize();
}

function measureEyeOffsetFromHead(bones: Record<BoneName, Object3D | null>): Vector3 | null {
  const head = bones.head;
  const eyes = [bones.leftEye, bones.rightEye].filter((eye): eye is Object3D => eye !== null);
  if (!head || eyes.length === 0) return null;

  const eyesMidpoint = new Vector3();
  for (const eye of eyes) eyesMidpoint.add(eye.getWorldPosition(worldPositionA));
  eyesMidpoint.divideScalar(eyes.length);
  const headRotationInverse = head.getWorldQuaternion(new Quaternion()).invert();
  return eyesMidpoint.sub(head.getWorldPosition(worldPositionB)).applyQuaternion(headRotationInverse);
}

function measureLimbLengths(bones: Record<BoneName, Object3D | null>, side: "left" | "right"): LimbLengths {
  return {
    upperArm: distanceBetween(bones[`${side}UpperArm`], bones[`${side}LowerArm`]),
    forearm: distanceBetween(bones[`${side}LowerArm`], bones[`${side}Hand`]),
    upperLeg: distanceBetween(bones[`${side}UpperLeg`], bones[`${side}LowerLeg`]),
    lowerLeg: distanceBetween(bones[`${side}LowerLeg`], bones[`${side}Foot`])
  };
}

const UP = new Vector3(0, 1, 0);

/**
 * Measures one hand in the rest pose: its finger bones come from the VRM humanoid extension when the glTF
 * has one and from name keywords below the hand otherwise; a hand without them is measured from the
 * forearm, with the palm taken to face down.
 */
function measureHand(
  bones: Record<BoneName, Object3D | null>,
  side: HandSide,
  vrmFingers: FingerBones | null,
  forward: Vector3
): HandDescription | null {
  const root = bones.root;
  const hand = bones[`${side}Hand`];
  if (!root || !hand) return null;

  const keywordFingers = mapFingerBonesByKeywords(hand);
  root.updateWorldMatrix(true, false);
  const worldToRoot = new Matrix4().copy(root.matrixWorld).invert();
  const inRoot = (object: Object3D | null): Vector3 | null =>
    object ? object.getWorldPosition(new Vector3()).applyMatrix4(worldToRoot) : null;
  const points: HandPoints = {
    wrist: inRoot(hand)!,
    lowerArm: inRoot(bones[`${side}LowerArm`]),
    index: inRoot(vrmFingers?.index ?? keywordFingers.index),
    middle: inRoot(vrmFingers?.middle ?? keywordFingers.middle),
    little: inRoot(vrmFingers?.little ?? keywordFingers.little)
  };
  // The model's right is its forward turned a quarter about the vertical; the left hand's outward is the opposite
  const outward = new Vector3().crossVectors(forward, UP);
  if (side === "left") outward.negate();

  const frame = new Quaternion();
  const source = measureHandFrame(side, points, outward, frame);
  if (!source) return null;
  const restInRoot = root
    .getWorldQuaternion(new Quaternion())
    .invert()
    .multiply(hand.getWorldQuaternion(new Quaternion()));
  return { boneOffset: frame.invert().multiply(restInRoot), source };
}

/**
 * Describes the rig of a loaded model. The bones come from the VRM humanoid extension when the glTF has
 * one and from name keywords otherwise; a bone the extension names but the scene lacks, and the root,
 * which VRM does not name, come from the keywords too. Call it before the model is posed: the rest pose
 * and the measurements are taken from the bones as they are.
 */
export function buildRigDescription(model: Object3D, gltf?: LoadedGltf): RigDescription {
  const keywordBones = mapBonesByKeywords(model);
  const vrm = gltf ? mapBonesFromVrm(gltf) : null;
  const bones = boneRecord<Object3D | null>(null);
  for (const name of BONE_NAMES) {
    bones[name] = vrm?.bones.get(name) ?? keywordBones.get(name) ?? null;
  }
  if (!bones.root && bones.hips?.parent) bones.root = bones.hips.parent;
  const source: RigSource = vrm && vrm.bones.size > 0 ? "vrm" : "keywords";

  const rest = boneRecord<RestPose | null>(null);
  for (const name of BONE_NAMES) {
    const bone = bones[name];
    if (bone) rest[name] = { position: bone.position.clone(), quaternion: bone.quaternion.clone() };
  }

  // The solver's measurements, kept as it made them: hand x in each hand's local space, and parentage
  const left = bones.leftHand ?? undefined;
  const right = bones.rightHand ?? undefined;
  const spine = bones.spine ?? undefined;
  const hips = bones.hips ?? undefined;
  const isFlippedY = (right?.position?.x || 0) - (left?.position?.x || 0) > 0;
  const isHalfBody = left?.parent === spine && right?.parent === spine && spine?.parent === hips;

  const forward = measureForward(bones, isFlippedY);
  const vrmFingers = gltf ? mapFingerBonesFromVrm(gltf) : null;

  return {
    source,
    bones,
    rest,
    forward,
    lengths: {
      hipsToHead: measureHipsToHead(bones.hips, bones.head),
      left: measureLimbLengths(bones, "left"),
      right: measureLimbLengths(bones, "right")
    },
    eyeOffsetFromHead: measureEyeOffsetFromHead(bones),
    isFlippedY,
    isHalfBody,
    hands: {
      left: measureHand(bones, "left", vrmFingers?.left ?? null, forward),
      right: measureHand(bones, "right", vrmFingers?.right ?? null, forward)
    }
  };
}
