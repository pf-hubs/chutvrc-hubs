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

/** Copies a child of the rig as copyObject does, its position multiplied by the rig's scale */
function copyRigChild(from: Object3D, to: TrackedPart, rigScale: number) {
  copyObject(from, to);
  to.pos.x *= rigScale;
  to.pos.y *= rigScale;
  to.pos.z *= rigScale;
}

/**
 * Reads the own rig, head and hands into the own pose once a frame, right before the solver runs, so
 * the own avatar follows this frame's camera and controllers. The local position and rotation of each
 * object are copied, as the timer sampler did; the solver never reads the scene objects themselves.
 *
 * The head and hands are children of the rig, placed by the headset and controllers in real metres, any
 * tracking offset of the body calibration included (it is applied to the XR reference space). Their
 * positions are multiplied by the rig's scale, so the pose is in room units, as the room sees the camera
 * and the controllers: any receiver, of this build or an older one, draws the hands where they are, also
 * for a rig the body calibration or the avatar_scale address parameter scales. The own avatar is solved
 * from the same values.
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
    // The rig is scaled uniformly; its own position is in the room already
    const rigScale = rig.scale.y;
    copyObject(rig, pose.rig);
    copyRigChild(head, pose.head, rigScale);
    copyRigChild(leftHand, pose.leftHand, rigScale);
    copyRigChild(rightHand, pose.rightHand, rigScale);
    // The head always has a pose; a controller is shown only while its device reports one
    pose.tracked =
      TRACKED_HEAD | (leftHand.visible ? TRACKED_LEFT_HAND : 0) | (rightHand.visible ? TRACKED_RIGHT_HAND : 0);
    // A stand-in renderer, such as a bot's, may have no WebXR manager: its pose is then not in VR
    const xr: WebGLRenderer["xr"] | undefined = this.renderer.xr;
    pose.isVR = !!xr && xr.enabled && xr.isPresenting;
    pose.receivedAt = now;
  }
}
