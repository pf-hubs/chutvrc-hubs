import { Object3D } from "three";
import { BONE_NAMES, BoneName } from "./bone-names";

/**
 * Finds the bones of a model by keywords in the object names, lower-cased. Mixamo-style rigs, which
 * ReadyPlayerMe avatars use, and most hand-named rigs are covered; a model with a VRM humanoid extension
 * is better served by the extension (bone-map-vrm.ts), with these keywords for the bones it lacks.
 */

type BoneKeywords = {
  /** One of these must appear for a sided bone; empty for a bone that has no side */
  side: readonly string[];
  /** "upper", "lower" and so on; a type keyword that needs one is tried only once a position matched */
  position: readonly string[];
  /** Type keywords that count only together with a position keyword, with high priority */
  typeWithPosition: readonly string[];
  /** Type keywords that count on their own; with low priority when the bone also has typeWithPosition keywords */
  typeWithoutPosition: readonly string[];
  /** The object's parent must be the bone already found under this name */
  parent: BoneName | null;
};

const LEFT = ["left", "_l", "l_", ".l", "l.", " l", "l "] as const;
const RIGHT = ["right", "_r", "r_", ".r", "r.", " r", "r "] as const;

const BONE_KEYWORDS: Readonly<Record<BoneName, BoneKeywords>> = {
  root: { side: [], position: [], typeWithPosition: [], typeWithoutPosition: ["root", "armature"], parent: null },
  hips: { side: [], position: [], typeWithPosition: [], typeWithoutPosition: ["hips", "bip", "pelvis"], parent: null },
  spine: { side: [], position: [], typeWithPosition: [], typeWithoutPosition: ["spine"], parent: null },
  chest: { side: [], position: [], typeWithPosition: [], typeWithoutPosition: ["chest", "spine"], parent: null },
  neck: { side: [], position: [], typeWithPosition: [], typeWithoutPosition: ["neck"], parent: null },
  head: { side: [], position: [], typeWithPosition: [], typeWithoutPosition: ["head"], parent: null },
  leftEye: { side: LEFT, position: [], typeWithPosition: [], typeWithoutPosition: ["eye"], parent: null },
  rightEye: { side: RIGHT, position: [], typeWithPosition: [], typeWithoutPosition: ["eye"], parent: null },
  leftUpperLeg: {
    side: LEFT,
    position: ["upper", "up"],
    typeWithPosition: ["leg"],
    typeWithoutPosition: ["thigh"],
    parent: "hips"
  },
  leftLowerLeg: {
    side: LEFT,
    position: ["lower", "low", "fore"],
    typeWithPosition: ["leg"],
    typeWithoutPosition: ["leg", "calf", "knee"],
    parent: null
  },
  leftFoot: { side: LEFT, position: [], typeWithPosition: [], typeWithoutPosition: ["foot", "shoe"], parent: null },
  rightUpperLeg: {
    side: RIGHT,
    position: ["upper", "up"],
    typeWithPosition: ["leg"],
    typeWithoutPosition: ["thigh"],
    parent: "hips"
  },
  rightLowerLeg: {
    side: RIGHT,
    position: ["lower", "low", "fore"],
    typeWithPosition: ["leg"],
    typeWithoutPosition: ["leg", "calf", "knee"],
    parent: null
  },
  rightFoot: { side: RIGHT, position: [], typeWithPosition: [], typeWithoutPosition: ["foot", "shoe"], parent: null },
  leftShoulder: {
    side: LEFT,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["shoulder", "clavicle"],
    parent: null
  },
  leftUpperArm: {
    side: LEFT,
    position: ["upper", "up"],
    typeWithPosition: ["arm"],
    typeWithoutPosition: ["arm"],
    parent: null
  },
  leftLowerArm: {
    side: LEFT,
    position: ["lower", "low", "fore"],
    typeWithPosition: ["arm"],
    typeWithoutPosition: ["elbow"],
    parent: null
  },
  leftHand: { side: LEFT, position: [], typeWithPosition: [], typeWithoutPosition: ["hand", "wrist"], parent: null },
  rightShoulder: {
    side: RIGHT,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["shoulder", "clavicle"],
    parent: null
  },
  rightUpperArm: {
    side: RIGHT,
    position: ["upper", "up"],
    typeWithPosition: ["arm"],
    typeWithoutPosition: ["arm"],
    parent: null
  },
  rightLowerArm: {
    side: RIGHT,
    position: ["lower", "low", "fore"],
    typeWithPosition: ["arm"],
    typeWithoutPosition: ["elbow"],
    parent: null
  },
  rightHand: { side: RIGHT, position: [], typeWithPosition: [], typeWithoutPosition: ["hand", "wrist"], parent: null }
};

enum MatchPriority {
  NONE,
  LOW,
  HIGH
}

/** Cuts the first occurrence of the keyword out of the name, so a later keyword cannot match the same letters */
function cutOut(name: string, keyword: string): string {
  const index = name.indexOf(keyword);
  return name.slice(0, index) + name.slice(index + keyword.length);
}

function matchBoneName(objectName: string, keywords: BoneKeywords): MatchPriority {
  let name = objectName.toLowerCase();
  let isPositionMatched = false;
  let isTypeMatched = false;
  let priority = MatchPriority.NONE;

  if (keywords.position.length > 0) {
    const keyword = keywords.position.find(keyword => name.includes(keyword));
    if (keyword) {
      name = cutOut(name, keyword);
      isPositionMatched = true;
    }
  }
  if (isPositionMatched && keywords.typeWithPosition.length > 0) {
    const keyword = keywords.typeWithPosition.find(keyword => name.includes(keyword));
    if (keyword) {
      name = cutOut(name, keyword);
      isTypeMatched = true;
      priority = MatchPriority.HIGH;
    }
  }
  if (!isTypeMatched && !isPositionMatched && keywords.typeWithoutPosition.length > 0) {
    const keyword = keywords.typeWithoutPosition.find(keyword => name.includes(keyword));
    if (keyword) {
      name = cutOut(name, keyword);
      isTypeMatched = true;
      priority = keywords.typeWithPosition.length > 0 ? MatchPriority.LOW : MatchPriority.HIGH;
    }
  }
  const isSideMatched = keywords.side.length === 0 || keywords.side.some(keyword => name.includes(keyword));

  return isTypeMatched && isSideMatched ? priority : MatchPriority.NONE;
}

/**
 * Maps the bones by name. Mapping starts at the first object named like a root, or at the first object
 * named like the hips, whose parent then counts as the root. From there every object is tried against the
 * bones not yet found with high priority, in bone order: a high-priority match settles the bone, a
 * low-priority match holds it until a better one comes along.
 */
export function mapBonesByKeywords(model: Object3D): Map<BoneName, Object3D> {
  const bones = new Map<BoneName, Object3D>();
  const settled = new Set<BoneName>();
  let isMappingStarted = false;

  model.traverse(child => {
    if (isMappingStarted) {
      for (const name of BONE_NAMES) {
        if (settled.has(name)) continue;
        const keywords = BONE_KEYWORDS[name];
        const priority = matchBoneName(child.name, keywords);
        if (keywords.parent && child.parent && bones.get(keywords.parent) !== child.parent) continue;
        if (priority === MatchPriority.LOW) {
          if (!bones.get(name)) bones.set(name, child);
        }
        if (priority === MatchPriority.HIGH) {
          bones.set(name, child);
          settled.add(name);
          break;
        }
      }
    } else if (matchBoneName(child.name, BONE_KEYWORDS.root) !== MatchPriority.NONE) {
      isMappingStarted = true;
      bones.set("root", child);
      settled.add("root");
    } else if (matchBoneName(child.name, BONE_KEYWORDS.hips) !== MatchPriority.NONE && child.parent) {
      isMappingStarted = true;
      bones.set("root", child.parent);
      bones.set("hips", child);
      settled.add("root");
      settled.add("hips");
    }
  });

  return bones;
}
