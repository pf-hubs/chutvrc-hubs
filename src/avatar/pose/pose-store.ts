import { AvatarAnimState } from "../../types/avatar-types";
import { createTrackedPose, TrackedPose } from "./tracked-pose";

/**
 * Every avatar's pose, keyed by client id, and which avatar entity shows which client's pose.
 *
 * There is one per page (APP.avatarPoses). It outlives the media server session, so the poses and the
 * bindings survive a reconnect or a change of adapter; a session only writes into it. A pose lives as
 * long as its client is in the room; a binding lives as long as its entity, which binds itself when it
 * is created and unbinds itself when it is removed.
 */
export class PoseStore {
  private readonly poses = new Map<string, TrackedPose>();
  private readonly clientIdByEid = new Map<number, string>();

  get(clientId: string): TrackedPose | undefined {
    return this.poses.get(clientId);
  }

  has(clientId: string): boolean {
    return this.poses.has(clientId);
  }

  /** The client's pose, created at the origin on first use so the solver has an input before the first packet */
  getOrCreate(clientId: string, isNPC = false): TrackedPose {
    let pose = this.poses.get(clientId);
    if (!pose) {
      pose = createTrackedPose(isNPC);
      this.poses.set(clientId, pose);
    }
    return pose;
  }

  /** Forgets the client's pose; an entity still bound to the client is left alone until the next packet */
  delete(clientId: string) {
    this.poses.delete(clientId);
  }

  /** From now on the avatar entity shows this client's pose */
  bindEntity(avatarEid: number, clientId: string) {
    this.clientIdByEid.set(avatarEid, clientId);
  }

  unbindEntity(avatarEid: number) {
    this.clientIdByEid.delete(avatarEid);
  }

  clientIdOf(avatarEid: number): string | undefined {
    return this.clientIdByEid.get(avatarEid);
  }

  setVrMode(clientId: string, isVR: boolean) {
    this.getOrCreate(clientId).isVR = isVR;
  }

  setAnimState(clientId: string, animState: AvatarAnimState) {
    this.getOrCreate(clientId).animState = animState;
  }

  forEach(callback: (pose: TrackedPose, clientId: string) => void) {
    this.poses.forEach(callback);
  }
}
