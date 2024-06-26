import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { Transform } from "../../types/transform";
import { JointInitSettings, LimbIk } from "./limb-ik";

const VECTOR_UP = new Vector3(0, 1, 0);

export class LegIk extends LimbIk {
  private isLeft: boolean;

  constructor(
    avatarRootBone: Object3D,
    avatarHipsBone: Object3D,
    base: JointInitSettings,
    elbow: JointInitSettings,
    effector: Object3D,
    isFlippedY: boolean,
    isLeft: boolean
  ) {
    super(avatarRootBone, avatarHipsBone, base, elbow, effector, isFlippedY);

    this.elbow.isYRotFixed = true;
    this.isLeft = isLeft;
  }

  protected override updateCurrentInput(input: Transform | null, cameraTransform: Transform) {
    if (input) {
      // TODO: use tracker position if it exists
    } else {
      this.currentInputPosition
        .set(this.isLeft ? 0.15 : -0.15, 0, -0.1)
        .applyAxisAngle(VECTOR_UP, this.avatarRoot.rotation.y - Math.PI + cameraTransform.rot.y)
        .add(this.avatarRootWorldPos);
    }
  }

  protected override adjustEffectorTransform(input: Transform | null) {
    if (input) {
      this.effector.rotation.set(this.isFlippedY ? input.rot.x : -input.rot.x, input.rot.y, input.rot.z, "YXZ");
    } else {
      this.effector.rotation.set(this.isFlippedY ? 0 : Math.PI / 3, 0, 0, "YXZ");
    }
    this.effector.rotation._onChangeCallback();
    this.effector.updateMatrix();
  }

  // protected override adjustElbow() {}
}
