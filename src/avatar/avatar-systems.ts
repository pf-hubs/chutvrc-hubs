import { HubsWorld } from "../app";
import { avatarIkSystem } from "./avatar-ik-system";
import { tickPoseSenders } from "./net/pose-sender";

/**
 * The avatar work of one frame, in this order: every started sender reads the own rig, head and hands
 * into the pose it sends (the room's session under the own client id, a public speaking sender under its
 * own) and sends it, every remote pose is blended as of a short time ago, and every avatar is solved from
 * its pose. The frame loop calls this after the network systems and before the add-ons'
 * beforeMatricesUpdate and the world matrix update; `t` is the frame's time, as world.time.elapsed has it.
 */
export function avatarSystemsTick(world: HubsWorld, t: number) {
  tickPoseSenders(t);
  APP.avatarPoses.sample(t);
  avatarIkSystem(world, APP.avatarPoses);
}
