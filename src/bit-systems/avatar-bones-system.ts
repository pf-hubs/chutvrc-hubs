import { addComponent, addEntity, defineQuery, removeEntity } from "bitecs";
import { Object3D, Quaternion, Vector3 } from "three";
import { BoneType } from "../constants";
import { AvatarComponent, BoneComponent } from "../bit-components";
import { addObject3DComponent } from "../utils/jsx-entity";
import { HubsWorld } from "../app";
import { mapAvatarBone } from "../utils/map-avatar-bones";
import { Transform } from "../types/transform";
import { AvatarIkManager } from "../utils/avatar-ik-manager";

export type InputTransformById = {
  rig: Map<string, Transform>;
  hmd: Map<string, Transform>;
  leftController: Map<string, Transform>;
  rightController: Map<string, Transform>;
};

export type InputTransform = {
  rig: Transform;
  hmd: Transform;
  leftController: Transform;
  rightController: Transform;
};

/*
class BoneProxy {
  eid: number;
  store: any;
  obj: Object3D;

  constructor(eid: number, obj: Object3D) { 
    this.eid = eid
    this.store = BoneComponent
    this.obj = obj
  }

  get position ()    { return this.store.transform.position[this.eid] }
  set position (val) { this.store.transform.position[this.eid] = val }

  get rotation ()    { return this.store.transform.rotation[this.eid] }
  set rotation (val) { this.store.transform.rotation[this.eid] = val }

  get worldPos ()    { return this.store.transform.position[this.eid] }
  set worldPos (val) { this.store.transform.position[this.eid] = val }

  get worldRot ()    { return this.store.transform.rotation[this.eid] }
  set worldRot (val) { this.store.transform.rotation[this.eid] = val }
}
*/

export const createBoneEntity = (
  world: HubsWorld,
  bone: Object3D | undefined,
  root: Object3D | undefined,
  boneType?: BoneType
): number | null => {
  if (!bone) return null;
  // if (bone.name.toLowerCase().includes("root")) {
  //   if (bone.parent) bone.parent.position.y += 1;
  // }
  const eid = addEntity(world);

  // TODO: when creating the bone entity, calculate offset matrix for a required bone when there are optional bones between it and its parent in advance
  // TODO: function or property to calculate world coordinates (for every tick use)

  /*
  // position
  Object.defineProperty(bone.position, "eid", { get: () => eid });
  Object.defineProperty(bone.position, "store", { get: () => BoneComponent.transform.position });

  Object.defineProperty(bone.position, "x", {
    get() {
      return this.store.x[this.eid];
    },
    set(n) {
      this.store.x[this.eid] = n;
    }
  });
  Object.defineProperty(bone.position, "y", {
    get() {
      return this.store.y[this.eid];
    },
    set(n) {
      this.store.y[this.eid] = n;
    }
  });
  Object.defineProperty(bone.position, "z", {
    get() {
      return this.store.z[this.eid];
    },
    set(n) {
      this.store.z[this.eid] = n;
    }
  });

  // rotation
  Object.defineProperty(bone.rotation, "eid", { get: () => eid });
  Object.defineProperty(bone.rotation, "store", { get: () => BoneComponent.transform.rotation });

  Object.defineProperty(bone.rotation, "_x", {
    get() {
      return this.store.x[this.eid];
    },
    set(n) {
      this.store.x[this.eid] = n;
    }
  });
  Object.defineProperty(bone.rotation, "_y", {
    get() {
      return this.store.y[this.eid];
    },
    set(n) {
      this.store.y[this.eid] = n;
    }
  });
  Object.defineProperty(bone.rotation, "_z", {
    get() {
      return this.store.z[this.eid];
    },
    set(n) {
      this.store.z[this.eid] = n;
    }
  });
  */

  addObject3DComponent(world, eid, bone);
  addComponent(world, BoneComponent, eid);

  return eid;
};

export const createAvatarEntity = (
  world: HubsWorld,
  boneType2Eid: Map<number, number>,
  clientId?: string,
  avatarEid2ClientId?: Map<number, string>
): number => {
  const eid = addEntity(world);

  addComponent(world, AvatarComponent, eid);
  if (clientId && avatarEid2ClientId) avatarEid2ClientId.set(eid, clientId);

  AvatarComponent.root[eid] = boneType2Eid.get(BoneType.Root) || 0;
  AvatarComponent.hips[eid] = boneType2Eid.get(BoneType.Hips) || 0;
  AvatarComponent.spine[eid] = boneType2Eid.get(BoneType.Spine) || 0;
  AvatarComponent.chest[eid] = boneType2Eid.get(BoneType.Chest) || 0;
  AvatarComponent.neck[eid] = boneType2Eid.get(BoneType.Neck) || 0;
  AvatarComponent.head[eid] = boneType2Eid.get(BoneType.Head) || 0;
  AvatarComponent.leftUpperLeg[eid] = boneType2Eid.get(BoneType.LeftUpperLeg) || 0;
  AvatarComponent.leftLowerLeg[eid] = boneType2Eid.get(BoneType.LeftLowerLeg) || 0;
  AvatarComponent.leftFoot[eid] = boneType2Eid.get(BoneType.LeftFoot) || 0;
  AvatarComponent.rightUpperLeg[eid] = boneType2Eid.get(BoneType.RightUpperLeg) || 0;
  AvatarComponent.rightLowerLeg[eid] = boneType2Eid.get(BoneType.RightLowerLeg) || 0;
  AvatarComponent.rightFoot[eid] = boneType2Eid.get(BoneType.RightFoot) || 0;
  AvatarComponent.leftShoulder[eid] = boneType2Eid.get(BoneType.LeftShoulder) || 0;
  AvatarComponent.leftUpperArm[eid] = boneType2Eid.get(BoneType.LeftUpperArm) || 0;
  AvatarComponent.leftLowerArm[eid] = boneType2Eid.get(BoneType.LeftLowerArm) || 0;
  AvatarComponent.leftHand[eid] = boneType2Eid.get(BoneType.LeftHand) || 0;
  AvatarComponent.rightShoulder[eid] = boneType2Eid.get(BoneType.RightShoulder) || 0;
  AvatarComponent.rightUpperArm[eid] = boneType2Eid.get(BoneType.RightUpperArm) || 0;
  AvatarComponent.rightLowerArm[eid] = boneType2Eid.get(BoneType.RightLowerArm) || 0;
  AvatarComponent.rightHand[eid] = boneType2Eid.get(BoneType.RightHand) || 0;

  return eid;
};

export const createSelfAvatarBoneEntities = (world: HubsWorld, avatar: Object3D) => {
  const avatarBoneMap = mapAvatarBone(avatar);
  const boneType2Eid = new Map<BoneType, number>();
  const avatarRoot = avatarBoneMap.get(BoneType.Root);
  // TODO: check avatar's orientation by relative positions between hands, etc. Then rotate the avatar if necessary.

  var boneEid;
  for (const boneType of Object.values(BoneType)) {
    boneEid = createBoneEntity(world, avatarBoneMap.get(boneType as BoneType), avatarRoot, boneType as BoneType);
    if (boneEid) boneType2Eid.set(boneType as BoneType, boneEid);
  }

  if (boneType2Eid.size > 0) {
    const avatarEid = createAvatarEntity(APP.world, boneType2Eid);
    if (avatarEid) {
      addObject3DComponent(world, avatarEid, avatar);

      // const leftHandX = APP.world.eid2obj.get(AvatarComponent.leftHand[avatarEid])?.position?.x || 0;
      // const rightHandX = APP.world.eid2obj.get(AvatarComponent.rightHand[avatarEid])?.position?.x || 0;
      APP.world.eid2Ik.set(avatarEid, new AvatarIkManager(world, avatarEid));

      // let chestPos = avatarBoneMap.get(BoneType.Chest)?.position;
      // let neckPos = avatarBoneMap.get(BoneType.Neck)?.position;
      // let headPos = avatarBoneMap.get(BoneType.Head)?.position;
      // if (chestPos && neckPos && headPos) {
      //   invHipsToHeadVector.addVectors(chestPos, neckPos).add(headPos).negate();
      // }
      return avatarEid;
    }
  }
  return null;
};

export const createAvatarBoneEntities = (
  world: HubsWorld,
  avatar: Object3D,
  clientId: string,
  avatarEid2ClientId: Map<number, string>,
  clientId2AvatarEid: Map<string, number>
): number | null => {
  const avatarBoneMap = mapAvatarBone(avatar);
  const boneType2Eid = new Map<BoneType, number>();
  const avatarRoot = avatarBoneMap.get(BoneType.Root);
  // TODO: check avatar's orientation by relative positions between hands, etc. Then rotate the avatar if necessary.

  var boneEid;
  for (const boneType of Object.values(BoneType)) {
    boneEid = createBoneEntity(world, avatarBoneMap.get(boneType as BoneType), avatarRoot, boneType as BoneType);
    if (boneEid) boneType2Eid.set(boneType as BoneType, boneEid);
  }

  if (boneType2Eid.size > 0) {
    const avatarEid = createAvatarEntity(APP.world, boneType2Eid, clientId, avatarEid2ClientId);
    if (avatarEid) {
      avatarEid2ClientId.set(avatarEid, clientId);
      clientId2AvatarEid.set(clientId, avatarEid);
      addObject3DComponent(world, avatarEid, avatar);

      // const leftHandX = APP.world.eid2obj.get(AvatarComponent.leftHand[avatarEid])?.position?.x || 0;
      // const rightHandX = APP.world.eid2obj.get(AvatarComponent.rightHand[avatarEid])?.position?.x || 0;
      APP.world.eid2Ik.set(avatarEid, new AvatarIkManager(world, avatarEid));

      // let chestPos = avatarBoneMap.get(BoneType.Chest)?.position;
      // let neckPos = avatarBoneMap.get(BoneType.Neck)?.position;
      // let headPos = avatarBoneMap.get(BoneType.Head)?.position;
      // if (chestPos && neckPos && headPos) {
      //   invHipsToHeadVector.addVectors(chestPos, neckPos).add(headPos).negate();
      // }
      return avatarEid;
    }
  }
  return null;
};

export const avatarQuery = defineQuery([AvatarComponent]);

// let invHipsToHeadVector = new Vector3();

export const avatarIkSystem = (
  world: HubsWorld,
  avatarPoseInputs: InputTransformById,
  avatarEid2ClientId: Map<number, string>,
  isVrByClientId: Map<string, boolean>
) => {
  avatarQuery(world).forEach(avatarEid => {
    const clientId = avatarEid2ClientId.get(avatarEid);
    if (clientId) {
      APP.world.eid2Ik.get(avatarEid)?.updateAvatarBoneIkById(
        // avatarEid,
        avatarPoseInputs,
        clientId,
        isVrByClientId.get(clientId) || false
        // world.time.delta
      );
    }
  });

  return world;
};

export const removeAvatarEntityAndModel = (world: HubsWorld, avatarEid: number | undefined) => {
  if (!avatarEid) return;
  const model = world.eid2obj.get(avatarEid);
  if (model) world.scene.remove(model);

  removeEntity(world, AvatarComponent.root[avatarEid]);
  removeEntity(world, AvatarComponent.hips[avatarEid]);
  removeEntity(world, AvatarComponent.spine[avatarEid]);
  removeEntity(world, AvatarComponent.chest[avatarEid]);
  removeEntity(world, AvatarComponent.neck[avatarEid]);
  removeEntity(world, AvatarComponent.head[avatarEid]);
  removeEntity(world, AvatarComponent.leftUpperLeg[avatarEid]);
  removeEntity(world, AvatarComponent.leftLowerLeg[avatarEid]);
  removeEntity(world, AvatarComponent.leftFoot[avatarEid]);
  removeEntity(world, AvatarComponent.rightUpperLeg[avatarEid]);
  removeEntity(world, AvatarComponent.rightLowerLeg[avatarEid]);
  removeEntity(world, AvatarComponent.rightFoot[avatarEid]);
  removeEntity(world, AvatarComponent.leftShoulder[avatarEid]);
  removeEntity(world, AvatarComponent.leftUpperArm[avatarEid]);
  removeEntity(world, AvatarComponent.leftLowerArm[avatarEid]);
  removeEntity(world, AvatarComponent.leftHand[avatarEid]);
  removeEntity(world, AvatarComponent.rightShoulder[avatarEid]);
  removeEntity(world, AvatarComponent.rightUpperArm[avatarEid]);
  removeEntity(world, AvatarComponent.rightLowerArm[avatarEid]);
  removeEntity(world, AvatarComponent.rightHand[avatarEid]);
  removeEntity(world, avatarEid);
};
