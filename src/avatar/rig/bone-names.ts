/**
 * The bones an avatar rig can have, named once for the whole client. The order is the one the bone
 * mappers try them in and the one the avatar component lists its fields in; the eyes sit after the head
 * because the keyword table was in this order and a bone's place in the table decides its priority.
 */
export const BONE_NAMES = [
  "root",
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "leftEye",
  "rightEye",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
  "leftShoulder",
  "leftUpperArm",
  "leftLowerArm",
  "leftHand",
  "rightShoulder",
  "rightUpperArm",
  "rightLowerArm",
  "rightHand"
] as const;

export type BoneName = (typeof BONE_NAMES)[number];

export type EyeBoneName = "leftEye" | "rightEye";

/** The bones that get an entity and a field of the avatar component: every bone but the eyes */
export type BodyBoneName = Exclude<BoneName, EyeBoneName>;

function isBodyBone(name: BoneName): name is BodyBoneName {
  return name !== "leftEye" && name !== "rightEye";
}

/** The body bones in the order of the avatar component's fields */
export const BODY_BONE_NAMES: readonly BodyBoneName[] = BONE_NAMES.filter(isBodyBone);

/** A record with the given value under every bone name; the per-bone records of a rig description start from it */
export function boneRecord<T>(value: T): Record<BoneName, T> {
  const record = {} as Record<BoneName, T>;
  for (const name of BONE_NAMES) record[name] = value;
  return record;
}

/** A record with the given value under every body bone name; the avatar component's schema is built from it */
export function bodyBoneRecord<T>(value: T): Record<BodyBoneName, T> {
  const record = {} as Record<BodyBoneName, T>;
  for (const name of BODY_BONE_NAMES) record[name] = value;
  return record;
}
