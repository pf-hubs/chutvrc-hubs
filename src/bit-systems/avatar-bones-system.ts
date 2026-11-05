import { defineQuery } from "bitecs";
import { AvatarComponent } from "../bit-components";
import { HubsWorld } from "../app";
import { Transform } from "../types/transform";
import { PoseStore } from "../avatar/pose/pose-store";

export type InputTransform = {
  rig: Transform;
  hmd: Transform;
  leftController: Transform;
  rightController: Transform;
  leftFoot?: Transform;
  rightFoot?: Transform;
};

export const avatarQuery = defineQuery([AvatarComponent]);

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
