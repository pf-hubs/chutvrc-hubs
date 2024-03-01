import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { CCDIKSolver } from "./ccdik-solver";
import { Transform } from "../../types/transform";

const VECTOR_UP = new Vector3(0, 1, 0);

export type JointInitSettings = {
  bone: Object3D | undefined;
  rotationOrder: string;
  rotationMin: Vector3;
  rotationMax: Vector3;
};

export type Joint = {
  bone: Object3D;
  rotationOrder: string;
  rotationMin: Vector3;
  rotationMax: Vector3;
  ikSolver: CCDIKSolver;
  isYRotFixed: boolean;
};

export class LimbIk {
  protected avatarRoot: Object3D;
  protected avatarHips: Object3D;
  protected avatarRootWorldPos: Vector3;
  protected base: Joint;
  protected elbow: Joint;
  protected effector: Object3D;
  protected currentInputPosition: Vector3;
  protected isFlippedY: boolean;
  protected isVR: boolean;
  protected isSelfAvatar: boolean;

  constructor(
    avatarRootBone: Object3D,
    avatarHipsBone: Object3D,
    base: JointInitSettings,
    elbow: JointInitSettings,
    effector: Object3D,
    isFlippedY: boolean
  ) {
    this.avatarRoot = avatarRootBone;
    this.avatarHips = avatarHipsBone;
    if (base.bone) {
      this.base = {
        bone: base.bone,
        rotationOrder: base.rotationOrder,
        rotationMin: base.rotationMin,
        rotationMax: base.rotationMax,
        ikSolver: new CCDIKSolver(base.bone, effector, base.rotationMin, base.rotationMax),
        isYRotFixed: false
      };
    }
    if (elbow.bone) {
      this.elbow = {
        bone: elbow.bone,
        rotationOrder: elbow.rotationOrder,
        rotationMin: elbow.rotationMin,
        rotationMax: elbow.rotationMax,
        ikSolver: new CCDIKSolver(elbow.bone, effector, elbow.rotationMin, elbow.rotationMax),
        isYRotFixed: false
      };
    }
    this.effector = effector;
    this.isFlippedY = isFlippedY;
    this.avatarRootWorldPos = new Vector3();
    this.currentInputPosition = new Vector3();
  }

  protected updateCurrentInput(input: Transform | null, cameraTransform: Transform) {
    if (!input) return;
    this.currentInputPosition
      .set(-input.pos.x, input.pos.y, -input.pos.z)
      .applyAxisAngle(VECTOR_UP, this.avatarRoot.rotation.y - Math.PI)
      .add(this.avatarRootWorldPos);
  }

  protected adjustElbow() {}
  protected adjustEffectorTransform(input: Transform | null) {
    if (!input) return;
    this.effector.rotation.set(this.isFlippedY ? input.rot.x : -input.rot.x, input.rot.y, input.rot.z, "YXZ");
    this.effector.rotation._onChangeCallback();
    this.effector.updateMatrix();
  }

  solve(input: Transform | null, cameraTransform: Transform, isVR: boolean, isSelfAvatar: boolean) {
    this.isVR = isVR;
    this.isSelfAvatar = isSelfAvatar;
    this.avatarRoot.getWorldPosition(this.avatarRootWorldPos);
    this.updateCurrentInput(input, cameraTransform);

    this.adjustEffectorTransform(input);

    for (let _ = 0; _ < 3; _++) {
      this.base?.ikSolver?.alignBoneWithGoal(this.currentInputPosition);
      this.elbow?.ikSolver?.alignBoneWithGoal(this.currentInputPosition, this.effector.rotation.y);
    }

    this.adjustElbow();
  }
}
