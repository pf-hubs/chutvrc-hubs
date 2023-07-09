import { addComponent, addEntity, defineQuery } from "bitecs";
import { Object3D } from "three";
import { BoneType } from "../constants";
import { findAvatarBone } from "../utils/find-avatar-bone";
import { AvatarComponent, BoneComponent } from "../bit-components";
import { addObject3DComponent } from "../utils/jsx-entity";
import { HubsWorld } from "../app";

type Vector3 = { x: number; y: number; z: number };
type Quaternion = { x: number; y: number; z: number };
type Transform = { pos: Vector3; rot: Quaternion };

export type InputTransform = {
  hmd: Map<string, Transform>;
  leftController: Map<string, Transform>;
  rightController: Map<string, Transform>;
};

export const createBoneEntity = (world: HubsWorld, avatar: Object3D, boneType: BoneType): number | null => {
  const eid = addEntity(world);
  const bone: Object3D | null = findAvatarBone(avatar, boneType); // boneTypeに合ったボーンのobject3Dをavatarの中で探す

  if (!bone) return null;

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
  BoneComponent.boneType[eid] = boneType;

  return eid;
};

export const createAvatarEntity = (world: HubsWorld, clientId: string, boneEids?: Map<BoneType, number>): number => {
  const eid = addEntity(world);

  addComponent(world, AvatarComponent, eid);
  AvatarComponent.clientId[eid] = clientId;
  boneEids?.forEach((bEid, bone) => {
    if (bone === BoneType.HEAD) AvatarComponent.head[eid] = bEid;
    if (bone === BoneType.LEFT_HAND) AvatarComponent.head[eid] = bEid;
    if (bone === BoneType.RIGHT_HAND) AvatarComponent.head[eid] = bEid;
  });

  return eid;
};

export const avatarQuery = defineQuery([AvatarComponent]);

export const avatarIkSystem = (world: HubsWorld, avatarPoseInputs: InputTransform) => {
  // const {
  //   time: { delta, elapsed }
  // } = world;

  const avatarEntityEids = avatarQuery(world);

  avatarEntityEids.forEach(avatarEid => {
    const clientId = AvatarComponent.clientId[avatarEid];
    assignTransform(world, AvatarComponent.head[avatarEid], avatarPoseInputs.hmd.get(clientId));
    assignTransform(world, AvatarComponent.leftHand[avatarEid], avatarPoseInputs.hmd.get(clientId));
    assignTransform(world, AvatarComponent.rightHand[avatarEid], avatarPoseInputs.hmd.get(clientId));

    // 他のボーンはIK計算をしてから同じことを行う
    // TODO
  });

  return world;
};

const assignTransform = (world: HubsWorld, boneEid: number, inputTransform: Transform | undefined) => {
  if (!inputTransform) return;
  BoneComponent.transform.position.x[boneEid] = inputTransform.pos.x;
  BoneComponent.transform.position.y[boneEid] = inputTransform.pos.y;
  BoneComponent.transform.position.z[boneEid] = inputTransform.pos.z;
  BoneComponent.transform.rotation.x[boneEid] = inputTransform.rot.x;
  BoneComponent.transform.rotation.y[boneEid] = inputTransform.rot.y;
  BoneComponent.transform.rotation.z[boneEid] = inputTransform.rot.z;
  world.eid2obj.get(boneEid)?.rotation?._onChangeCallback();
};
