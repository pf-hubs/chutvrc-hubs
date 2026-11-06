import { HubsWorld } from "../app";
import { avatarIkSystem } from "./avatar-ik-system";
import { tickPoseSenders } from "./net/pose-sender";

/**
 * The avatar work of one frame, in this order: the own rig, head and hands are read into the own pose,
 * the started senders send it, every remote pose is blended as of a short time ago, and every avatar is
 * solved from its pose. The frame loop calls this after the network systems and before the add-ons'
 * beforeMatricesUpdate and the world matrix update; `t` is the frame's time, as world.time.elapsed has it.
 */
export function avatarSystemsTick(world: HubsWorld, t: number) {
  APP.sfu.avatarSync?.localPoseSource?.sample(t);
  tickPoseSenders(t);
  APP.avatarPoses.sample(t);
  avatarIkSystem(world, APP.avatarPoses);
}
