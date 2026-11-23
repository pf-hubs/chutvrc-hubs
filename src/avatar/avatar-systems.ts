import { HubsWorld } from "../app";
import { avatarIkSystem } from "./avatar-ik-system";
import { bodyCalibration } from "./calibration/apply-calibration";
import { tickPoseSenders } from "./net/pose-sender";

/**
 * The avatar work of one frame, in this order: the body calibration is applied to the own rig and to the
 * reference spaces of the headset and controllers (the poses take it from the next frame), every started
 * sender reads the own rig, head and hands into the pose it sends (the room's session under the own client
 * id, a public speaking sender under its own) and sends it, every remote pose is blended as of a short time
 * ago, and every avatar is solved from its pose. The frame loop calls this after the network systems and before the add-ons'
 * beforeMatricesUpdate and the world matrix update; `t` is the frame's time, as world.time.elapsed has it.
 */
export function avatarSystemsTick(world: HubsWorld, t: number) {
  bodyCalibration.tick(t);
  tickPoseSenders(t);
  // The room's sender starts once its pose channel is open; until then, or if it never opens, the own
  // pose is read here, so the own avatar follows the devices all the same
  const roomSync = APP.sfu.avatarSync;
  if (roomSync && !roomSync.poseSender.isRunning) roomSync.localPoseSource?.sample(t);
  APP.avatarPoses.sample(t);
  avatarIkSystem(world, APP.avatarPoses);
}
