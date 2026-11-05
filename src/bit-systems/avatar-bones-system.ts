import { addComponent, addEntity, defineQuery, removeEntity } from "bitecs";
import { Object3D } from "three";
import { BoneType } from "../constants";
import { AvatarComponent, BoneComponent } from "../bit-components";
import { addObject3DComponent } from "../utils/jsx-entity";
import { HubsWorld } from "../app";
import { mapAvatarBone } from "../utils/map-avatar-bones";
import { Transform } from "../types/transform";
import { AvatarIkManager } from "../utils/avatar-ik-manager";
import { PoseStore } from "../avatar/pose/pose-store";
import { npcClientId } from "../avatar/pose/npc-pose-source";

export type InputTransform = {
  rig: Transform;
  hmd: Transform;
  leftController: Transform;
  rightController: Transform;
  leftFoot?: Transform;
  rightFoot?: Transform;
};

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

  addObject3DComponent(world, eid, bone);
  addComponent(world, BoneComponent, eid);

  return eid;
};

export const createAvatarEntity = (world: HubsWorld, boneType2Eid: Map<number, number>): number => {
  const eid = addEntity(world);

  addComponent(world, AvatarComponent, eid);

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

/**
 * Creates the bone and avatar entities of a loaded model and its inverse kinematics manager. With `showsPose`
 * the avatar entity is bound to the client's pose, or without a client id to a synthetic one that the chatbot
 * writes, and the solver moves it every frame; a session whose avatars are not shown leaves it unbound.
 */
export const createAvatarBoneEntities = (
  avatar: Object3D,
  clientId?: string,
  clientId2AvatarEid?: Map<string, number>,
  showsPose = true
): number | null => {
  const avatarBoneMap = mapAvatarBone(avatar);
  const boneType2Eid = new Map<BoneType, number>();
  const avatarRoot = avatarBoneMap.get(BoneType.Root);
  // TODO: check avatar's orientation by relative positions between hands, etc. Then rotate the avatar if necessary.

  var boneEid;
  for (const boneType of Object.values(BoneType)) {
    boneEid = createBoneEntity(APP.world, avatarBoneMap.get(boneType as BoneType), avatarRoot, boneType as BoneType);
    if (boneEid) boneType2Eid.set(boneType as BoneType, boneEid);
  }

  if (boneType2Eid.size > 0) {
    const avatarEid = createAvatarEntity(APP.world, boneType2Eid);
    if (avatarEid) {
      const isNPC = !clientId;
      if (clientId) {
        if (clientId2AvatarEid) clientId2AvatarEid.set(clientId, avatarEid);
        addObject3DComponent(APP.world, avatarEid, avatar);
      }
      if (showsPose) {
        const poseClientId = clientId || npcClientId(avatarEid);
        APP.avatarPoses.getOrCreate(poseClientId, isNPC);
        APP.avatarPoses.bindEntity(avatarEid, poseClientId);
      }

      // const leftHandX = APP.world.eid2obj.get(AvatarComponent.leftHand[avatarEid])?.position?.x || 0;
      // const rightHandX = APP.world.eid2obj.get(AvatarComponent.rightHand[avatarEid])?.position?.x || 0;
      APP.world.eid2Ik.set(avatarEid, new AvatarIkManager(APP.world, avatarEid, isNPC));

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

/**
 * Solves every avatar entity from the pose of the client it is bound to. A pose the chatbot writes is
 * solved only on the frames it is written in, as the chatbot's direct call to the solver was; a write
 * since the previous tick counts as this frame's.
 */
export const avatarIkSystem = (world: HubsWorld, poses: PoseStore) => {
  const previousTick = world.time.elapsed - world.time.delta;
  avatarQuery(world).forEach(avatarEid => {
    const clientId = poses.clientIdOf(avatarEid);
    if (!clientId) return;
    const pose = poses.get(clientId);
    if (!pose) return;
    if (pose.isNPC && (pose.receivedAt === 0 || pose.receivedAt < previousTick)) return;
    world.eid2Ik.get(avatarEid)?.updateAvatarBoneIkById(pose, clientId);
  });

  return world;
};

/**
 * Removes the avatar's model from the scene, its bone and avatar entities, its inverse kinematics manager
 * and its binding to a pose. The pose itself stays: the client may get a new avatar.
 */
export const removeAvatarEntityAndModel = (world: HubsWorld, avatarEid: number | undefined) => {
  if (!avatarEid) return;
  const model = world.eid2obj.get(avatarEid);
  if (model) world.scene.remove(model);

  // A bone the model does not have is stored as 0, which is the reserved entity 0 and must stay
  const removeBoneEntity = (boneEid: number) => {
    if (boneEid) removeEntity(world, boneEid);
  };
  removeBoneEntity(AvatarComponent.root[avatarEid]);
  removeBoneEntity(AvatarComponent.hips[avatarEid]);
  removeBoneEntity(AvatarComponent.spine[avatarEid]);
  removeBoneEntity(AvatarComponent.chest[avatarEid]);
  removeBoneEntity(AvatarComponent.neck[avatarEid]);
  removeBoneEntity(AvatarComponent.head[avatarEid]);
  removeBoneEntity(AvatarComponent.leftUpperLeg[avatarEid]);
  removeBoneEntity(AvatarComponent.leftLowerLeg[avatarEid]);
  removeBoneEntity(AvatarComponent.leftFoot[avatarEid]);
  removeBoneEntity(AvatarComponent.rightUpperLeg[avatarEid]);
  removeBoneEntity(AvatarComponent.rightLowerLeg[avatarEid]);
  removeBoneEntity(AvatarComponent.rightFoot[avatarEid]);
  removeBoneEntity(AvatarComponent.leftShoulder[avatarEid]);
  removeBoneEntity(AvatarComponent.leftUpperArm[avatarEid]);
  removeBoneEntity(AvatarComponent.leftLowerArm[avatarEid]);
  removeBoneEntity(AvatarComponent.leftHand[avatarEid]);
  removeBoneEntity(AvatarComponent.rightShoulder[avatarEid]);
  removeBoneEntity(AvatarComponent.rightUpperArm[avatarEid]);
  removeBoneEntity(AvatarComponent.rightLowerArm[avatarEid]);
  removeBoneEntity(AvatarComponent.rightHand[avatarEid]);
  removeEntity(world, avatarEid);
  world.eid2Ik.delete(avatarEid);
  APP.avatarPoses.unbindEntity(avatarEid);
};
