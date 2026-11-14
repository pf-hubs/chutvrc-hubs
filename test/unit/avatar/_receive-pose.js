import { POSE_PARTS } from "../../../src/avatar/net/interpolation-buffer";
import { decodeBody, isOlderSeq } from "../../../src/avatar/net/pose-codec-v1";
import { createTrackedPose } from "../../../src/avatar/pose/tracked-pose";
import { isValidAvatarAnimState } from "../../../src/types/avatar-types";

/**
 * The receive path of a whole-body packet, copied from PoseSync.handlePoseMessage in
 * src/avatar/net/pose-sync.ts, the recording left out. It is copied because pose-sync.ts cannot be loaded
 * in Node: it imports the avatar model manager, which pulls in the A-Frame scene. The late-packet rule and
 * SEQ_RESTART_AFTER_MS, which pose-sync.ts does not export, must be kept in step with that file by hand.
 * Everything it calls (decodeBody, isOlderSeq, PoseStore.getOrCreate and pushRemotePart) is the product's.
 */
export const SEQ_RESTART_AFTER_MS = 2000;

const receivedBody = createTrackedPose();

/**
 * Hands one packet to the store as the client does when it arrives at `now`. Returns true when the parts
 * were pushed, false when the packet was dropped as late, and null for a packet of the own client.
 */
export function receivePosePacket(store, data, now, ownClientId) {
  const body = receivedBody;
  const header = decodeBody(data, body);
  const clientId = header.clientId;
  body.tracked = header.tracked;
  body.isVR = header.isVR;
  if (isValidAvatarAnimState(header.animState)) body.animState = header.animState;
  if (clientId === ownClientId) return null;

  const pose = store.getOrCreate(clientId);
  // The late-packet rule, as in pose-sync.ts
  if (pose.seq >= 0 && isOlderSeq(header.seq, pose.seq) && now - pose.receivedAt < SEQ_RESTART_AFTER_MS) return false;
  for (const part of POSE_PARTS) {
    store.pushRemotePart(clientId, part, now, body[part], body[part].quat);
  }
  pose.tracked = header.tracked;
  pose.isVR = header.isVR;
  if (isValidAvatarAnimState(header.animState)) pose.animState = header.animState;
  pose.seq = header.seq;
  pose.senderTimeMs = header.timeMs;
  return true;
}
