export enum COLLISION_LAYERS {
  ALL = -1,
  NONE = 0,
  INTERACTABLES = 1 << 0,
  ENVIRONMENT = 1 << 1,
  AVATAR = 1 << 2,
  HANDS = 1 << 3,
  MEDIA_FRAMES = 1 << 4,
  // @TODO we should split these "sets" off into something other than COLLISION_LAYERS or at least name
  // them differently to indicate they are a combination of multiple bits
  DEFAULT_INTERACTABLE = INTERACTABLES | ENVIRONMENT | AVATAR | HANDS | MEDIA_FRAMES,
  UNOWNED_INTERACTABLE = INTERACTABLES | HANDS | MEDIA_FRAMES,
  DEFAULT_SPAWNER = INTERACTABLES | HANDS
}

export enum AAModes {
  NONE = "NONE",
  SMAA = "SMAA",
  MSAA_2X = "MSAA_2X",
  MSAA_4X = "MSAA_4X",
  MSAA_8X = "MSAA_8X"
}

export const PRIVACY = "https://www.mozilla.org/en-US/privacy/hubs/";
export const TERMS = "https://www.mozilla.org/en-US/about/legal/terms/hubs/";

// export enum BoneType {
//   ROOT,
//   HEAD,
//   LEFT_HAND,
//   RIGHT_HAND
// }

export enum BoneType {
  Root,
  Hips,
  Spine,
  Chest,
  Neck,
  Head,
  LeftEye,
  RightEye,
  LeftUpperLeg,
  LeftLowerLeg,
  LeftFoot,
  RightUpperLeg,
  RightLowerLeg,
  RightFoot,
  LeftShoulder,
  LeftUpperArm,
  LeftLowerArm,
  LeftHand,
  RightShoulder,
  RightUpperArm,
  RightLowerArm,
  RightHand
}

// export type BoneTypeName = BoneType | keyof typeof BoneType;

const boneNameSideKeywords = {
  left: ["left", "_l", "l_", ".l", "l.", " l", "l "],
  right: ["right", "_r", "r_", ".r", "r.", " r", "r "]
};

// if all direct children are array -> match them all without overlapping with each other
// else -> match only one of them
export const boneNameKeywords = {
  [BoneType.Root]: {
    side: [],
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["root"],
    parentsWithSimilarName: [],
    parent: null
  },
  [BoneType.Hips]: {
    side: [],
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["hips", "bip", "pelvis"],
    parentsWithSimilarName: [],
    parent: null
  },
  [BoneType.Spine]: {
    side: [],
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["spine"],
    parentsWithSimilarName: [],
    parent: null
  },
  [BoneType.Chest]: {
    side: [],
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["chest", "spine"],
    parentsWithSimilarName: [BoneType.Spine],
    parent: null
  },
  [BoneType.Neck]: {
    side: [],
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["neck"],
    parentsWithSimilarName: [],
    parent: null
  },
  [BoneType.Head]: {
    side: [],
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["head"],
    parentsWithSimilarName: [],
    parent: null
  },
  [BoneType.LeftEye]: {
    side: boneNameSideKeywords.left,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["eye"],
    parentsWithSimilarName: [],
    parent: null
  },
  [BoneType.RightEye]: {
    side: boneNameSideKeywords.right,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["eye"],
    parentsWithSimilarName: [],
    parent: null
  },
  [BoneType.LeftUpperLeg]: {
    side: boneNameSideKeywords.left,
    position: ["upper", "up"],
    typeWithPosition: ["leg"],
    typeWithoutPosition: ["thigh"],
    parentsWithSimilarName: [],
    parent: BoneType.Hips
  },
  [BoneType.LeftLowerLeg]: {
    side: boneNameSideKeywords.left,
    position: ["lower", "low", "fore"],
    typeWithPosition: ["leg"],
    typeWithoutPosition: ["leg", "calf", "knee"],
    parentsWithSimilarName: [BoneType.LeftUpperLeg],
    parent: null
  },
  [BoneType.LeftFoot]: {
    side: boneNameSideKeywords.left,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["foot", "shoe"],
    parentsWithSimilarName: [],
    parent: null
  },
  [BoneType.RightUpperLeg]: {
    side: boneNameSideKeywords.right,
    position: ["upper", "up"],
    typeWithPosition: ["leg"],
    typeWithoutPosition: ["thigh"],
    parentsWithSimilarName: [],
    parent: BoneType.Hips
  },
  [BoneType.RightLowerLeg]: {
    side: boneNameSideKeywords.right,
    position: ["lower", "low", "fore"],
    typeWithPosition: ["leg"],
    typeWithoutPosition: ["leg", "calf", "knee"],
    parentsWithSimilarName: [BoneType.RightUpperLeg],
    parent: null
  },
  [BoneType.RightFoot]: {
    side: boneNameSideKeywords.right,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["foot", "shoe"],
    parentsWithSimilarName: [],
    parent: null
  },
  [BoneType.LeftShoulder]: {
    side: boneNameSideKeywords.left,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["shoulder", "clavicle"],
    parentsWithSimilarName: [],
    parent: null
  },
  [BoneType.LeftUpperArm]: {
    side: boneNameSideKeywords.left,
    position: ["upper", "up"],
    typeWithPosition: ["arm"],
    typeWithoutPosition: ["arm"],
    parentsWithSimilarName: [],
    parent: null
  },
  [BoneType.LeftLowerArm]: {
    side: boneNameSideKeywords.left,
    position: ["lower", "low", "fore"],
    typeWithPosition: ["arm"],
    typeWithoutPosition: ["elbow"],
    parentsWithSimilarName: [BoneType.LeftUpperArm],
    parent: null
  },
  [BoneType.LeftHand]: {
    side: boneNameSideKeywords.left,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["hand", "wrist"],
    parentsWithSimilarName: [],
    parent: null
  },
  [BoneType.RightShoulder]: {
    side: boneNameSideKeywords.right,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["shoulder", "clavicle"],
    parentsWithSimilarName: [],
    parent: null
  },
  [BoneType.RightUpperArm]: {
    side: boneNameSideKeywords.right,
    position: ["upper", "up"],
    typeWithPosition: ["arm"],
    typeWithoutPosition: ["arm"],
    parentsWithSimilarName: [],
    parent: null
  },
  [BoneType.RightLowerArm]: {
    side: boneNameSideKeywords.right,
    position: ["lower", "low", "fore"],
    typeWithPosition: ["arm"],
    typeWithoutPosition: ["elbow"],
    parentsWithSimilarName: [BoneType.RightUpperArm],
    parent: null
  },
  [BoneType.RightHand]: {
    side: boneNameSideKeywords.right,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["hand", "wrist"],
    parentsWithSimilarName: [],
    parent: null
  }
};
