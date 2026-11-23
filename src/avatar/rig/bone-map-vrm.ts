import { Object3D } from "three";
import { BoneName } from "./bone-names";
import { FingerBones, HandSide } from "./hand-frame";

/**
 * Finds the bones of a model from the VRM humanoid extension of its glTF. VRM 0.x lists them as
 * `extensions.VRM.humanoid.humanBones[]`, each `{ bone, node }`; VRM 1.0 keys them by name under
 * `extensions.VRMC_vrm.humanoid.humanBones`, each `{ node }`. The node indices are turned into the loaded
 * objects through the associations the glTF loader keeps between its objects and the document.
 */

type VrmHumanBone0 = { bone?: string; node?: number };
type VrmHumanBone1 = { node?: number };

type GltfJson = {
  extensions?: {
    VRM?: { humanoid?: { humanBones?: VrmHumanBone0[] } };
    VRMC_vrm?: { humanoid?: { humanBones?: Record<string, VrmHumanBone1> } };
  };
};

/** The part of a loaded glTF that the mapping reads: the document and the loader's object associations */
export type LoadedGltf = {
  parser?: {
    json?: GltfJson;
    associations?: Map<unknown, { nodes?: number } | undefined>;
  };
};

export type VrmVersion = "0.x" | "1.0";

/**
 * Our name for each VRM humanoid bone that the rig uses. VRM 0.x and 1.0 name the bones the same way.
 * VRM bones without a counterpart (upperChest, jaw, the toes and the fingers) are left to the model, and
 * VRM names no root: the rig takes the object above the hips as the root.
 */
const BONE_NAME_BY_VRM_BONE: Readonly<Record<string, BoneName>> = {
  hips: "hips",
  spine: "spine",
  chest: "chest",
  neck: "neck",
  head: "head",
  leftEye: "leftEye",
  rightEye: "rightEye",
  leftUpperLeg: "leftUpperLeg",
  leftLowerLeg: "leftLowerLeg",
  leftFoot: "leftFoot",
  rightUpperLeg: "rightUpperLeg",
  rightLowerLeg: "rightLowerLeg",
  rightFoot: "rightFoot",
  leftShoulder: "leftShoulder",
  leftUpperArm: "leftUpperArm",
  leftLowerArm: "leftLowerArm",
  leftHand: "leftHand",
  rightShoulder: "rightShoulder",
  rightUpperArm: "rightUpperArm",
  rightLowerArm: "rightLowerArm",
  rightHand: "rightHand"
};

export type VrmBoneMap = {
  version: VrmVersion;
  /** The bones whose node was found in the loaded scene */
  bones: Map<BoneName, Object3D>;
  /** The bones the extension names but whose node could not be found; the keywords are tried for these */
  unresolved: BoneName[];
};

/** The humanoid bones as (VRM bone name, node index) pairs, whichever VRM version the document has */
function humanBoneNodes(json: GltfJson): { version: VrmVersion; entries: [string, number][] } | null {
  const vrm1 = json.extensions?.VRMC_vrm?.humanoid?.humanBones;
  if (vrm1) {
    const entries: [string, number][] = [];
    for (const [bone, { node }] of Object.entries(vrm1)) {
      if (typeof node === "number") entries.push([bone, node]);
    }
    return { version: "1.0", entries };
  }
  const vrm0 = json.extensions?.VRM?.humanoid?.humanBones;
  if (vrm0) {
    const entries: [string, number][] = [];
    for (const { bone, node } of vrm0) {
      if (typeof bone === "string" && typeof node === "number") entries.push([bone, node]);
    }
    return { version: "0.x", entries };
  }
  return null;
}

/** The loaded object of each glTF node index, from the loader's associations of the objects in the scene */
function objectsByNodeIndex(gltf: LoadedGltf): Map<number, Object3D> {
  const byIndex = new Map<number, Object3D>();
  gltf.parser?.associations?.forEach((mapping, object) => {
    if (mapping?.nodes !== undefined && (object as Object3D).isObject3D) byIndex.set(mapping.nodes, object as Object3D);
  });
  return byIndex;
}

/** The VRM humanoid bones that are the first bone of an index, middle or little finger */
const VRM_FINGER_BONE = /^(left|right)(Index|Middle|Little)Proximal$/;

/**
 * The first bones of the index, middle and little fingers of each hand, as the VRM humanoid extension names
 * them; null when the glTF has no such extension. They are used to measure the hands (hand-frame.ts) and
 * are left to the model otherwise.
 */
export function mapFingerBonesFromVrm(gltf: LoadedGltf): Record<HandSide, FingerBones> | null {
  const json = gltf.parser?.json;
  if (!json) return null;
  const humanBones = humanBoneNodes(json);
  if (!humanBones) return null;

  const objects = objectsByNodeIndex(gltf);
  const fingers: Record<HandSide, FingerBones> = {
    left: { index: null, middle: null, little: null },
    right: { index: null, middle: null, little: null }
  };
  for (const [vrmBone, nodeIndex] of humanBones.entries) {
    const match = VRM_FINGER_BONE.exec(vrmBone);
    if (!match) continue;
    fingers[match[1] as HandSide][match[2].toLowerCase() as keyof FingerBones] = objects.get(nodeIndex) ?? null;
  }
  return fingers;
}

/** The bones the VRM humanoid extension names, or null when the glTF has no such extension */
export function mapBonesFromVrm(gltf: LoadedGltf): VrmBoneMap | null {
  const json = gltf.parser?.json;
  if (!json) return null;
  const humanBones = humanBoneNodes(json);
  if (!humanBones) return null;

  const objects = objectsByNodeIndex(gltf);
  const bones = new Map<BoneName, Object3D>();
  const unresolved: BoneName[] = [];
  for (const [vrmBone, nodeIndex] of humanBones.entries) {
    const name = BONE_NAME_BY_VRM_BONE[vrmBone];
    if (!name) continue;
    const object = objects.get(nodeIndex);
    if (object) {
      bones.set(name, object);
    } else {
      unresolved.push(name);
    }
  }
  return { version: humanBones.version, bones, unresolved };
}
