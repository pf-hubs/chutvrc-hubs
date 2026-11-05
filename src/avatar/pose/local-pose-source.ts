import { Object3D, WebGLRenderer } from "three";
import { PoseStore } from "./pose-store";
import { copyXyz } from "./tracked-pose";

/** The own rig and the objects the headset and controllers move, as the scene has them */
export type LocalPoseObjects = {
  rig: Object3D;
  head: Object3D;
  leftHand: Object3D;
  rightHand: Object3D;
};

/**
 * Reads the own rig, head and hands into the own pose once a frame, right before the solver runs, so
 * the own avatar follows this frame's camera and controllers. The local position and rotation of each
 * object are copied, as the timer sampler did; the solver never reads the scene objects themselves.
 */
export class LocalPoseSource {
  constructor(
    private readonly store: PoseStore,
    private readonly clientId: string,
    private readonly objects: LocalPoseObjects,
    private readonly renderer: WebGLRenderer
  ) {}

  /** `now` is the frame's time, as `world.time.elapsed` gives it */
  sample(now: number) {
    const pose = this.store.getOrCreate(this.clientId);
    const { rig, head, leftHand, rightHand } = this.objects;
    copyXyz(rig.position, pose.rig.pos);
    copyXyz(rig.rotation, pose.rig.rot);
    copyXyz(head.position, pose.head.pos);
    copyXyz(head.rotation, pose.head.rot);
    copyXyz(leftHand.position, pose.leftHand.pos);
    copyXyz(leftHand.rotation, pose.leftHand.rot);
    copyXyz(rightHand.position, pose.rightHand.pos);
    copyXyz(rightHand.rotation, pose.rightHand.rot);
    pose.isVR = this.renderer.xr.enabled && this.renderer.xr.isPresenting;
    pose.receivedAt = now;
  }
}
