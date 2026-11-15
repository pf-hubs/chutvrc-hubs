import { Object3D, WebGLRenderer } from "three";
import { PoseStore } from "./pose-store";
import { copyQuat, copyXyz, TRACKED_HEAD, TRACKED_LEFT_HAND, TRACKED_RIGHT_HAND, TrackedPart } from "./tracked-pose";

/** The own rig and the objects the headset and controllers move, as the scene has them */
export type LocalPoseObjects = {
  rig: Object3D;
  head: Object3D;
  leftHand: Object3D;
  rightHand: Object3D;
};

/**
 * Copies an object's local position and rotation. three.js keeps an object's Euler angles and quaternion
 * equal to each other, so both are read rather than one converted from the other.
 */
function copyObject(from: Object3D, to: TrackedPart) {
  copyXyz(from.position, to.pos);
  copyXyz(from.rotation, to.rot);
  copyQuat(from.quaternion, to.quat);
}

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
    copyObject(rig, pose.rig);
    copyObject(head, pose.head);
    copyObject(leftHand, pose.leftHand);
    copyObject(rightHand, pose.rightHand);
    // The head always has a pose; a controller is shown only while its device reports one
    pose.tracked =
      TRACKED_HEAD | (leftHand.visible ? TRACKED_LEFT_HAND : 0) | (rightHand.visible ? TRACKED_RIGHT_HAND : 0);
    // A stand-in renderer, such as a bot's, may have no WebXR manager: its pose is then not in VR
    const xr: WebGLRenderer["xr"] | undefined = this.renderer.xr;
    pose.isVR = !!xr && xr.enabled && xr.isPresenting;
    pose.receivedAt = now;
  }
}
