import { addComponent, addEntity, defineQuery } from "bitecs";
import { Object3D } from "three";
import { BoneType } from "../constants";
// import { findAvatarBone } from "../utils/map-avatar-bones";
import { AvatarComponent, BoneComponent } from "../bit-components";
import { addObject3DComponent } from "../utils/jsx-entity";
import { HubsWorld } from "../app";
import { mapAvatarBone } from "../utils/map-avatar-bones";

type Vector3 = { x: number; y: number; z: number };
type Quaternion = { x: number; y: number; z: number };
type Transform = { pos: Vector3; rot: Quaternion };

export type InputTransform = {
  rig: Map<string, Transform>;
  hmd: Map<string, Transform>;
  leftController: Map<string, Transform>;
  rightController: Map<string, Transform>;
};

export const createBoneEntity = (world: HubsWorld, bone: Object3D | undefined, boneType?: BoneType): number | null => {
  if (!bone) return null;
  const eid = addEntity(world);

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

  addObject3DComponent(world, eid, bone);

  addComponent(world, BoneComponent, eid);
  // BoneComponent.boneType[eid] = boneType;

  return eid;
};

export const createAvatarEntity = (
  world: HubsWorld,
  clientId: string,
  avatarEid2ClientId: Map<number, string>,
  boneType2Eid?: Map<number, number>
): number => {
  const eid = addEntity(world);

  addComponent(world, AvatarComponent, eid);
  avatarEid2ClientId.set(eid, clientId);

  if (boneType2Eid) {
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
  }

  return eid;
};

export const createAvatarBoneEntities = (
  world: HubsWorld,
  avatar: Object3D,
  clientId: string,
  avatarEid2ClientId: Map<number, string>
): number | null => {
  const avatarBoneMap = mapAvatarBone(avatar);
  const boneType2Eid = new Map<BoneType, number>();

  var boneEid;
  for (const boneType of Object.values(BoneType)) {
    boneEid = createBoneEntity(world, avatarBoneMap.get(boneType as BoneType), boneType as BoneType);
    if (boneEid) boneType2Eid.set(boneType as BoneType, boneEid);
  }

  if (boneType2Eid.size > 0) {
    const avatarEid = createAvatarEntity(APP.world, clientId, avatarEid2ClientId, boneType2Eid);
    if (avatarEid) {
      avatarEid2ClientId.set(avatarEid, clientId);
      return avatarEid;
    }
  }
  return null;
};

export const avatarQuery = defineQuery([AvatarComponent]);

export const avatarIkSystem = (
  world: HubsWorld,
  avatarPoseInputs: InputTransform,
  avatarEid2ClientId: Map<number, string>
) => {
  const {
    time: { delta, elapsed }
  } = world;

  const avatarEntityEids = avatarQuery(world);

  avatarEntityEids.forEach(avatarEid => {
    const clientId = avatarEid2ClientId.get(avatarEid);
    if (clientId) {
      assignTransform(world, AvatarComponent.root[avatarEid], avatarPoseInputs.rig.get(clientId), {
        pos: { x: 0, y: 0, z: 0 },
        rot: { x: 0, y: Math.PI, z: 0 }
      });
      assignTransform(world, AvatarComponent.head[avatarEid], avatarPoseInputs.hmd.get(clientId));
      assignTransform(world, AvatarComponent.leftHand[avatarEid], avatarPoseInputs.hmd.get(clientId));
      assignTransform(world, AvatarComponent.rightHand[avatarEid], avatarPoseInputs.hmd.get(clientId));
    }

    // 他のボーンはIK計算をしてから同じことを行う
    // TODO
  });

  return world;
};

const assignTransform = (
  world: HubsWorld,
  boneEid: number,
  inputTransform: Transform | undefined,
  offset?: Transform
) => {
  if (!inputTransform) return;
  BoneComponent.transform.position.x[boneEid] = inputTransform.pos.x + (offset?.pos.x || 0);
  BoneComponent.transform.position.y[boneEid] = inputTransform.pos.y + (offset?.pos.y || 0);
  BoneComponent.transform.position.z[boneEid] = inputTransform.pos.z + (offset?.pos.z || 0);
  BoneComponent.transform.rotation.y[boneEid] = inputTransform.rot.x + (offset?.rot.y || 0);
  BoneComponent.transform.rotation.x[boneEid] = inputTransform.rot.y + (offset?.rot.x || 0);
  BoneComponent.transform.rotation.z[boneEid] = inputTransform.rot.z + (offset?.rot.z || 0);
  world.eid2obj.get(boneEid)?.rotation?._onChangeCallback();
  world.eid2obj.get(boneEid)?.updateMatrix();
};
