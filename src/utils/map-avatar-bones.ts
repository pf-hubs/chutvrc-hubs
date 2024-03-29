import { Object3D } from "three";
import { BoneType, boneNameKeywords } from "../constants";

enum BoneMapPriority {
  NONE,
  LOW,
  HIGH
}

const checkBoneNameMatching = (
  boneObjectName: string,
  keywords: {
    side: string[];
    position: string[];
    typeWithPosition: string[];
    typeWithoutPosition: string[];
    parentsWithSimilarName: BoneType[];
    parent?: BoneType | null;
  }
) => {
  boneObjectName = boneObjectName.toLowerCase();
  let isPositionMatched = false;
  let isTypeMatched = false;
  let isSideMatched = false;
  let priority = BoneMapPriority.NONE;

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
      priority = BoneMapPriority.HIGH;
    }
  }
  if (!isTypeMatched && !isPositionMatched && keywords.typeWithoutPosition.length > 0) {
    let keyword = keywords.typeWithoutPosition.find(keyword => boneObjectName.includes(keyword));
    if (keyword) {
      let index = boneObjectName.indexOf(keyword);
      boneObjectName = boneObjectName.slice(0, index) + boneObjectName.slice(index + keyword.length);
      isTypeMatched = true;
      priority = keywords.typeWithPosition.length > 0 ? BoneMapPriority.LOW : BoneMapPriority.HIGH;
    }
  }
  if (keywords.side.length > 0) {
    isSideMatched = keywords.side.some(keyword => boneObjectName.includes(keyword));
  } else {
    isSideMatched = true;
  }

  return isTypeMatched && isSideMatched ? priority : BoneMapPriority.NONE;
};

export const mapAvatarBone = (avatar: Object3D) => {
  let isMappingStarted = false;
  let clonedBoneNameKeywords = { ...boneNameKeywords };
  let boneTypeToObject = new Map<BoneType, Object3D>();

  avatar.traverse(child => {
    if (isMappingStarted) {
      for (const [boneName, keywords] of Object.entries(clonedBoneNameKeywords)) {
        const priority = checkBoneNameMatching(child.name, keywords);
        if (keywords.parent && child.parent && boneTypeToObject.get(keywords.parent) !== child.parent) continue;
        if (priority === BoneMapPriority.LOW) {
          if (!boneTypeToObject.get(parseInt(boneName) as BoneType)) {
            boneTypeToObject.set(parseInt(boneName) as BoneType, child);
          }
        }
        if (priority === BoneMapPriority.HIGH) {
          boneTypeToObject.set(parseInt(boneName) as BoneType, child);
          delete clonedBoneNameKeywords[parseInt(boneName) as BoneType];
          break;
        }
      }
    } else if (checkBoneNameMatching(child.name, boneNameKeywords[BoneType.Root]) !== BoneMapPriority.NONE) {
      isMappingStarted = true;
      boneTypeToObject.set(BoneType.Root, child);
      delete clonedBoneNameKeywords[BoneType["Root" as keyof typeof BoneType]];
    }
  });

  return boneTypeToObject;
};
