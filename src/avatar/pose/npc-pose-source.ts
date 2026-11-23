import { Transform } from "../../types/transform";
import { PoseStore } from "./pose-store";
import { copyTransform } from "./tracked-pose";

/** The pose the chatbot computes, in the shape it handed to the solver when it called it directly */
export type NpcPoseInput = {
  rig: Transform;
  hmd: Transform;
  leftController: Transform;
  rightController: Transform;
};

/** The client id under which an avatar that belongs to no client, such as the chatbot's, is stored and bound */
export function npcClientId(avatarEid: number): string {
  return `npc-${avatarEid}`;
}

/**
 * Writes the chatbot's pose into the store. The solver reads it on this frame, as it reads a received
 * pose, and leaves the bones alone on the frames the chatbot writes nothing, as the direct call did.
 */
export function writeNpcPose(
  store: PoseStore,
  avatarEid: number | null | undefined,
  input: NpcPoseInput,
  now = performance.now()
) {
  if (!avatarEid) return;
  const pose = store.getOrCreate(npcClientId(avatarEid), true);
  copyTransform(input.rig, pose.rig);
  copyTransform(input.hmd, pose.head);
  copyTransform(input.leftController, pose.leftHand);
  copyTransform(input.rightController, pose.rightHand);
  pose.receivedAt = now;
}
