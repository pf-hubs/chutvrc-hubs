import { Object3D } from "three";
import { BoneType, FullBodyBoneName, boneNameKeywords } from "../constants";

const checkBoneNameMatching = (
  boneObjectName: string,
  keywords: {
    side: string[];
    position: string[];
    typeWithPosition: string[];
    typeWithoutPosition: string[];
  }
) => {
  boneObjectName = boneObjectName.toLowerCase();
  let isPositionMatched = false;
  let isTypeMatched = false;
  let isSideMatched = false;
  if (keywords.position.length > 0) {
    let keyword = keywords.position.find(keyword => boneObjectName.includes(keyword));
    if (keyword) {
      let index = boneObjectName.indexOf(keyword);
      boneObjectName = boneObjectName.slice(0, index) + boneObjectName.slice(index + keyword.length);
      isPositionMatched = true;
    }
  }
  if (isPositionMatched && keywords.typeWithPosition.length > 0) {
    let keyword = keywords.typeWithPosition.find(keyword => boneObjectName.includes(keyword));
    if (keyword) {
      let index = boneObjectName.indexOf(keyword);
      boneObjectName = boneObjectName.slice(0, index) + boneObjectName.slice(index + keyword.length);
      isTypeMatched = true;
    }
  }
  if (!isTypeMatched && !isPositionMatched && keywords.typeWithoutPosition.length > 0) {
    let keyword = keywords.typeWithoutPosition.find(keyword => boneObjectName.includes(keyword));
    if (keyword) {
      let index = boneObjectName.indexOf(keyword);
      boneObjectName = boneObjectName.slice(0, index) + boneObjectName.slice(index + keyword.length);
      isTypeMatched = true;
    }
  }
  if (keywords.side.length > 0) {
    isSideMatched = keywords.position.some(keyword => boneObjectName.includes(keyword));
  } else {
    isSideMatched = true;
  }

  return isTypeMatched && isSideMatched;
};

export const mapAvatarBone = (avatar: Object3D) => {
  let isMappingStarted = false;
  let clonedBoneNameKeywords = { ...boneNameKeywords };
  let boneNameToObject = new Map<FullBodyBoneName, Object3D>();

  avatar.traverse(child => {
    if (isMappingStarted) {
      for (const [boneName, keywords] of Object.entries(clonedBoneNameKeywords)) {
        if (checkBoneNameMatching(child.name, keywords)) {
          boneNameToObject.set(boneName as FullBodyBoneName, child);
          delete clonedBoneNameKeywords[boneName as FullBodyBoneName];
        }
      }
    } else if (checkBoneNameMatching(child.name, boneNameKeywords[FullBodyBoneName.Root])) {
      isMappingStarted = true;
      boneNameToObject.set(FullBodyBoneName.Root, child);
      delete clonedBoneNameKeywords["Root" as FullBodyBoneName];
    }
  });

  return boneNameToObject;
};

export const findAvatarBone = (avatar: Object3D, boneType: BoneType): Object3D | null => {
  let result: Object3D | null = null;
  avatar.traverse(child => {
    if (!result) {
      switch (boneType) {
        case BoneType.ROOT:
          if (child.name.toLowerCase().includes("root")) result = child;
          break;
        case BoneType.HEAD:
          if (child.name.toLowerCase().includes("head")) result = child;
          break;
        case BoneType.LEFT_HAND:
          if (
            child.name.toLowerCase().includes("hand") &&
            (child.name.includes("L") || child.name.toLowerCase().includes("left"))
          )
            result = child;
          break;
        case BoneType.RIGHT_HAND:
          if (
            child.name.toLowerCase().includes("hand") &&
            (child.name.includes("R") || child.name.toLowerCase().includes("right"))
          )
            result = child;
          break;
        default:
          break;
      }
    }
  });

  return result;
};
