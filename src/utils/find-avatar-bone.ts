import { Object3D } from "three";
import { BoneType } from "../constants";

export const findAvatarBone = (avatar: Object3D, boneType: BoneType): Object3D | null => {
  let result: Object3D | null = null;
  avatar.traverse(child => {
    if (!result) {
      switch (boneType) {
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
