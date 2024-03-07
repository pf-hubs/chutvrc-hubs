import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { Transform } from "../../types/transform";
import { JointInitSettings, LimbIk } from "./limb-ik";

const FULL_BODY_HEAD_OFFSET = 0.1;
const VECTOR_UP = new Vector3(0, 1, 0);

export class HeadIk extends LimbIk {
  private headEffectorOffset: Vector3;

  constructor(
    avatarRootBone: Object3D,
    avatarHipsBone: Object3D,
    base: JointInitSettings,
    elbow: JointInitSettings,
    effector: Object3D,
    isFlippedY: boolean
  ) {
    super(avatarRootBone, avatarHipsBone, base, elbow, effector, isFlippedY);

    this.base.isYRotFixed = true;
    this.elbow.isYRotFixed = true;
    this.headEffectorOffset = new Vector3();
  }

  protected override updateCurrentInput(input: Transform | null, cameraTransform: Transform) {
    if (this.isSelfAvatar) {
      this.effector.getWorldDirection(this.headEffectorOffset);
      this.headEffectorOffset
        .projectOnPlane(VECTOR_UP)
        .multiplyScalar(FULL_BODY_HEAD_OFFSET * (this.isFlippedY ? 1 : -1));
    }

    if (!input) return;

    this.currentInputPosition
      .set(-input.pos.x, input.pos.y, -input.pos.z)
      .applyAxisAngle(VECTOR_UP, this.avatarRoot.rotation.y - Math.PI)
      .add(this.isSelfAvatar ? this.avatarRootWorldPos.clone().add(this.headEffectorOffset) : this.avatarRootWorldPos);

    // this.effector.position.set(this.currentInputPosition.x, this.currentInputPosition.y, this.currentInputPosition.z)
  }

  protected override adjustEffectorTransform(input: Transform | null) {
    if (!input) return;
    this.effector.rotation.set(this.isFlippedY ? input.rot.x : -input.rot.x, 0, input.rot.z, "YXZ");
    this.effector.rotation._onChangeCallback();
    this.effector.updateMatrix();
  }
}
