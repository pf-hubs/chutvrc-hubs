import { AvatarAnimState } from "../../types/avatar-types";
import { Transform } from "../../types/transform";
import { InterpolationBuffer, POSE_PARTS, PosePart } from "../net/interpolation-buffer";
import { createTrackedPose, TrackedPose } from "./tracked-pose";

/** How far behind their newest packet remote poses are shown unless PoseStore.interpolationDelayMs is changed */
export const DEFAULT_INTERPOLATION_DELAY_MS = 100;

/**
 * Every avatar's pose, keyed by client id, which avatar entity shows which client's pose, and the recent
 * packets of every remote client, from which its pose is blended once a frame.
 *
 * There is one per page (APP.avatarPoses). It outlives the media server session, so the poses and the
 * bindings survive a reconnect or a change of adapter; a session only writes into it. A pose lives as
 * long as its client is in the room; a binding lives as long as its entity, which binds itself when it
 * is created and unbinds itself when it is removed.
 *
 * A remote client's parts are not written as its packets arrive: the packets go into the client's
 * buffer, and `sample` writes the parts a little behind the newest packet, blended between the packets
 * around that moment, once a frame before the solver reads them. The own pose and the chatbot's have
 * no buffer; their sources write the parts directly.
 */
export class PoseStore {
  private readonly poses = new Map<string, TrackedPose>();
  private readonly clientIdByEid = new Map<number, string>();
  private readonly buffers = new Map<string, InterpolationBuffer>();
  /**
   * How far behind its newest packet a remote pose is shown, in milliseconds. The delay is what lets a
   * pose be blended between two received packets instead of jumping to each: it should cover the usual
   * spacing of the packets plus their arrival jitter, and all of it adds to the latency the others'
   * movements are seen with. There is no setting for it; to compare, set it from the console
   * (`APP.avatarPoses.interpolationDelayMs = 0` shows the newest packet, as before buffering).
   */
  interpolationDelayMs = DEFAULT_INTERPOLATION_DELAY_MS;

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

  /** Forgets the client's pose and packets; an entity still bound to the client is left alone until the next packet */
  delete(clientId: string) {
    this.poses.delete(clientId);
    this.buffers.delete(clientId);
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

  /**
   * Keeps one part of a remote client's pose, as received at `receivedAt` on the clock the frame loop
   * samples with (performance.now()), for `sample` to blend from. The arrival is noted on the pose at
   * once, as a direct write would have; the part itself is written by `sample`.
   */
  pushRemotePart(clientId: string, part: PosePart, receivedAt: number, transform: Readonly<Transform>) {
    const pose = this.getOrCreate(clientId);
    pose.receivedAt = receivedAt;
    let buffer = this.buffers.get(clientId);
    if (!buffer) {
      buffer = new InterpolationBuffer();
      this.buffers.set(clientId, buffer);
    }
    buffer.push(part, receivedAt, transform.pos, transform.rot);
  }

  /**
   * Writes every buffered client's pose as of `now - interpolationDelayMs` into its tracked pose. Called
   * once a frame, right before the solver reads the poses; a part without a packet yet is left alone.
   */
  sample(now: number) {
    const renderTime = now - this.interpolationDelayMs;
    for (const [clientId, buffer] of this.buffers) {
      const pose = this.poses.get(clientId);
      if (!pose) continue;
      for (const part of POSE_PARTS) {
        buffer.sample(part, renderTime, pose[part].pos, pose[part].rot);
      }
    }
  }

  forEach(callback: (pose: TrackedPose, clientId: string) => void) {
    this.poses.forEach(callback);
  }
}
