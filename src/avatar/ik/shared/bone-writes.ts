import { Quaternion, Vector3 } from "three";
import { BODY_BONE_NAMES, BodyBoneName, BoneName, bodyBoneRecord } from "../../rig/bone-names";

/** The bones whose local position is written as well as their rotation */
export type PositionBoneName = "root" | "hips" | "leftHand" | "rightHand";

export function isPositionBone(name: BoneName): name is PositionBoneName {
  return name === "root" || name === "hips" || name === "leftHand" || name === "rightHand";
}

/** What a solver writes in a frame: a local rotation per solved bone, a local position for a few, allocated once */
export type BoneWrites = {
  rotation: Record<BodyBoneName, Quaternion>;
  hasRotation: Record<BodyBoneName, boolean>;
  position: Record<PositionBoneName, Vector3>;
  hasPosition: Record<PositionBoneName, boolean>;
  /** The hands of an upper-body model are hidden while they have no controller to follow */
  handsHidden: boolean;
  /**
   * The root's uniform scale over its rest scale: the size the model is drawn at over its own size. Only the
   * VR solver draws a model at another size; every frame starts at 1.
   */
  rootScale: number;
};

export function createBoneWrites(): BoneWrites {
  const rotation = bodyBoneRecord<Quaternion>(null as unknown as Quaternion);
  for (const name of BODY_BONE_NAMES) rotation[name] = new Quaternion();
  return {
    rotation,
    hasRotation: bodyBoneRecord(false),
    position: { root: new Vector3(), hips: new Vector3(), leftHand: new Vector3(), rightHand: new Vector3() },
    hasPosition: { root: false, hips: false, leftHand: false, rightHand: false },
    handsHidden: false,
    rootScale: 1
  };
}

export function clearBoneWrites(out: BoneWrites) {
  for (const name of BODY_BONE_NAMES) out.hasRotation[name] = false;
  out.hasPosition.root = false;
  out.hasPosition.hips = false;
  out.hasPosition.leftHand = false;
  out.hasPosition.rightHand = false;
  out.handsHidden = false;
  out.rootScale = 1;
}
