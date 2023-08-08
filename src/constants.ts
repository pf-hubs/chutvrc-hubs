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

export enum BoneType {
  ROOT,
  HEAD,
  LEFT_HAND,
  RIGHT_HAND
}

export enum FullBodyBoneName {
  Root = "Root",
  Hips = "Hips",
  Spine = "Spine",
  Chest = "Chest",
  Neck = "Neck",
  Head = "Head",
  LeftUpperLeg = "LeftUpperLeg",
  LeftLowerLeg = "LeftLowerLeg",
  LeftFoot = "LeftFoot",
  RightUpperLeg = "RightUpperLeg",
  RightLowerLeg = "RightLowerLeg",
  RightFoot = "RightFoot",
  LeftShoulder = "LeftShoulder",
  LeftUpperArm = "LeftUpperArm",
  LeftLowerArm = "LeftLowerArm",
  LeftHand = "LeftHand",
  RightShoulder = "RightShoulder",
  RightUpperArm = "RightUpperArm",
  RightLowerArm = "RightLowerArm",
  RightHand = "RightHand"
}

export const boneHierarchy = {
  name: FullBodyBoneName.Root,
  children: {
    name: FullBodyBoneName.Hips,
    children: [
      {
        name: FullBodyBoneName.Spine,
        children: {
          name: FullBodyBoneName.Chest,
          children: [
            {
              name: FullBodyBoneName.Neck,
              children: {
                name: FullBodyBoneName.Head,
                children: {}
              }
            },
            {
              name: FullBodyBoneName.LeftShoulder,
              children: {
                name: FullBodyBoneName.LeftUpperArm,
                children: {
                  name: FullBodyBoneName.LeftLowerArm,
                  children: {
                    name: FullBodyBoneName.LeftHand,
                    children: {}
                  }
                }
              }
            },
            {
              name: FullBodyBoneName.RightShoulder,
              children: {
                name: FullBodyBoneName.RightUpperArm,
                children: {
                  name: FullBodyBoneName.RightLowerArm,
                  children: {
                    name: FullBodyBoneName.RightHand,
                    children: {}
                  }
                }
              }
            }
          ]
        }
      },
      {
        name: FullBodyBoneName.LeftUpperLeg,
        children: {
          name: FullBodyBoneName.LeftLowerLeg,
          children: {
            name: FullBodyBoneName.LeftFoot,
            children: {}
          }
        }
      },
      {
        name: FullBodyBoneName.RightUpperLeg,
        children: {
          name: FullBodyBoneName.RightLowerLeg,
          children: {
            name: FullBodyBoneName.RightFoot,
            children: {}
          }
        }
      }
    ]
  }
};

const boneNameSideKeywords = {
  left: ["left", "_l", "l_", ".l", "l.", " l", "l "],
  right: ["right", "_r", "r_", ".r", "r.", " r", "r "]
};

// if all direct children are array -> match them all without overlapping with each other
// else -> match only one of them
export const boneNameKeywords = {
  [FullBodyBoneName.Root]: {
    side: [],
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["root"]
  },
  [FullBodyBoneName.Hips]: {
    side: [],
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["hips", "bip", "pelvis"]
  },
  [FullBodyBoneName.Spine]: {
    side: [],
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["spine"]
  },
  [FullBodyBoneName.Chest]: {
    side: [],
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["chest", "spine"]
  },
  [FullBodyBoneName.Neck]: {
    side: [],
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["neck"]
  },
  [FullBodyBoneName.Head]: {
    side: [],
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["head"]
  },
  [FullBodyBoneName.LeftUpperLeg]: {
    side: boneNameSideKeywords.left,
    position: ["upper", "up"],
    typeWithPosition: ["leg"],
    typeWithoutPosition: ["thigh"]
  },
  [FullBodyBoneName.LeftLowerLeg]: {
    side: boneNameSideKeywords.left,
    position: ["lower", "low", "fore"],
    typeWithPosition: ["leg"],
    typeWithoutPosition: ["leg", "calf", "knee"]
  },
  [FullBodyBoneName.LeftFoot]: {
    side: boneNameSideKeywords.left,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["foot", "shoe"]
  },
  [FullBodyBoneName.RightUpperLeg]: {
    side: boneNameSideKeywords.right,
    position: ["upper", "up"],
    typeWithPosition: ["leg"],
    typeWithoutPosition: ["thigh"]
  },
  [FullBodyBoneName.RightLowerLeg]: {
    side: boneNameSideKeywords.right,
    position: ["lower", "low", "fore"],
    typeWithPosition: ["leg"],
    typeWithoutPosition: ["leg", "calf", "knee"]
  },
  [FullBodyBoneName.RightFoot]: {
    side: boneNameSideKeywords.right,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["foot", "shoe"]
  },
  [FullBodyBoneName.LeftShoulder]: {
    side: boneNameSideKeywords.left,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["shoulder", "clavicle"]
  },
  [FullBodyBoneName.LeftUpperArm]: {
    side: boneNameSideKeywords.left,
    position: ["upper", "up"],
    typeWithPosition: ["arm"],
    typeWithoutPosition: ["arm"]
  },
  [FullBodyBoneName.LeftLowerArm]: {
    side: boneNameSideKeywords.left,
    position: ["lower", "low", "fore"],
    typeWithPosition: ["arm"],
    typeWithoutPosition: ["elbow"]
  },
  [FullBodyBoneName.LeftHand]: {
    side: boneNameSideKeywords.left,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["hand", "wrist"]
  },
  [FullBodyBoneName.RightShoulder]: {
    side: boneNameSideKeywords.right,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["shoulder", "clavicle"]
  },
  [FullBodyBoneName.RightUpperArm]: {
    side: boneNameSideKeywords.right,
    position: ["upper", "up"],
    typeWithPosition: ["arm"],
    typeWithoutPosition: ["arm"]
  },
  [FullBodyBoneName.RightLowerArm]: {
    side: boneNameSideKeywords.right,
    position: ["lower", "low", "fore"],
    typeWithPosition: ["arm"],
    typeWithoutPosition: ["elbow"]
  },
  [FullBodyBoneName.RightHand]: {
    side: boneNameSideKeywords.right,
    position: [],
    typeWithPosition: [],
    typeWithoutPosition: ["hand", "wrist"]
  }
};
