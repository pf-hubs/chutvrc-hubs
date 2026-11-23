import { defineQuery } from "bitecs";
import { AvatarComponent } from "../bit-components";
import { HubsWorld } from "../app";
import { PoseStore } from "./pose/pose-store";

const avatarQuery = defineQuery([AvatarComponent]);

/**
 * Solves every avatar entity from the pose of the client it is bound to. A pose nothing has been written
 * to yet is all zeros, which would fold the body on the floor at the room's origin; it is not solved, and
 * its model stays hidden until the first pose arrives. A pose the chatbot writes is solved only on the
 * frames it is written in, as the chatbot's direct call to the solver was; a write since the previous
 * tick counts as this frame's.
 */
export const avatarIkSystem = (world: HubsWorld, poses: PoseStore) => {
  const previousTick = world.time.elapsed - world.time.delta;
  avatarQuery(world).forEach(avatarEid => {
    const clientId = poses.clientIdOf(avatarEid);
    if (!clientId) return;
    const pose = poses.get(clientId);
    if (!pose) return;
    if (pose.receivedAt === 0) return;
    if (pose.isNPC && pose.receivedAt < previousTick) return;
    world.eid2Ik.get(avatarEid)?.updateAvatarBoneIkById(pose, clientId);
  });

  return world;
};
