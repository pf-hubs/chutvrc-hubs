import { Euler, Matrix4, Mesh, Object3D, Quaternion, Vector3 } from "three";
import { Transform } from "../../types/transform";
import { JointInitSettings, LimbIk } from "./limb-ik";
import { TransformLowPassFilter } from "../transform-low-pass-filter";

const VECTOR_UP = new Vector3(0, 1, 0);
const parentWorldQuaternion = new Quaternion();

export class ArmIk extends LimbIk {
  private isDebug?: boolean;
  private isLeft: boolean;
  private isHalfBody: boolean;
  private isVisible: boolean;
  private inputFilter: TransformLowPassFilter;

  constructor(
    avatarRootBone: Object3D,
    avatarHipsBone: Object3D,
    base: JointInitSettings,
    elbow: JointInitSettings,
    effector: Object3D,
    isFlippedY: boolean,
    isLeft: boolean,
    isHalfBody: boolean,
    isDebug?: boolean
  ) {
    super(avatarRootBone, avatarHipsBone, base, elbow, effector, isFlippedY);

    if (this.elbow) {
      this.elbow.isYRotFixed = true;
      this.elbow.ikSolver.setYRotFixedFlag(true);
      this.elbow.bone.rotation.order = "XZY";
    }
    this.isLeft = isLeft;
    this.isHalfBody = isHalfBody;
    this.isVisible = true;
    this.inputFilter = new TransformLowPassFilter(0.3, 0.2);
    this.isDebug = isDebug;
    this.effector.rotation.order = "YXZ";
  }

  protected override updateCurrentInput(input: Transform | null, cameraTransform: Transform) {
    this.currentInputPosition
      .set(
        input && (this.isVR || this.isNPC) ? -input.pos.x : this.isLeft ? 0.3 : -0.3,
        input && (this.isVR || this.isNPC) ? input.pos.y : 0.9,
        input && (this.isVR || this.isNPC) ? -input.pos.z : 0
      )
      .applyAxisAngle(
        VECTOR_UP,
        this.avatarRoot.rotation.y - Math.PI + (this.isVR || this.isNPC ? 0 : cameraTransform.rot.y)
      )
      .add(this.avatarRootWorldPos);
  }

  protected override adjustElbow() {
    // if (!this.elbow.bone) return;
    // this.elbow.bone.rotation.set(
    //   this.elbow.bone.rotation.x,
    //   this.effector.rotation.y,
    //   this.elbow.bone.rotation.z,
    //   this.elbow.rotationOrder
    // );
  }

  // A half-body hand is not driven by an arm chain, so its position is written directly from the input
  private adjustEffectorPosition(input: Transform | null) {
    if (!this.isHalfBody || !input || !(this.isVR || this.isNPC)) return;
    const parent = this.effector.parent;

    // World position of the hand, expressed in the frame of its parent bone
    this.effector.position.copy(this.currentInputPosition);
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.worldToLocal(this.effector.position);
    }
    this.effector.updateMatrix();
  }

  protected override adjustEffectorTransform(input: Transform | null) {
    if (input && (this.isVR || this.isNPC) && this.avatarRoot) {
      const parent = this.effector.parent;
      let targetQ = new Quaternion();
      targetQ.setFromEuler(new Euler(input.rot.x, input.rot.y, input.rot.z, "YXZ"));

      // World rotation of the hand, then expressed in the frame of its parent bone:
      // local = inverse(parent world rotation) * world rotation
      this.effector.quaternion.copy(this.avatarRoot.quaternion).multiply(targetQ);
      if (parent) this.effector.quaternion.premultiply(parent.getWorldQuaternion(parentWorldQuaternion).invert());

      if (this.isFlippedY) {
        this.effector.rotateZ(this.isLeft ? Math.PI / 2 : -Math.PI / 2);
        if (!this.isVR) this.effector.rotateY(this.isLeft ? -Math.PI / 2 : Math.PI / 2);
      } else {
        this.effector.rotateX(-Math.PI / 3);
        if (!this.isVR) this.effector.rotateY(this.isLeft ? Math.PI / 2 : -Math.PI / 2);
      }
    } else {
      this.effector.rotation.set(0, 0, 0);
    }

    this.effector.rotation._onChangeCallback();
    this.effector.updateMatrix();
  }

  override solve(
    input: Transform | null,
    cameraTransform: Transform,
    isVR: boolean,
    isSelfAvatar: boolean,
    isNPC: boolean
  ) {
    if (this.isVisible && this.isHalfBody && !this.isVR && !this.isNPC) {
      this.isVisible = false;
      this.effector.position.set(0, 0, 0);
      this.effector.scale.set(0.1, 0.1, 0.1);
      this.effector.updateMatrix();
      return;
    } else if (!this.isVisible && (!this.isHalfBody || this.isVR || this.isNPC)) {
      this.isVisible = true;
      this.effector.scale.set(1, 1, 1);
    }

    if (input && (isVR || isNPC) && !this.isHalfBody) {
      input = this.inputFilter.getTransformWithFilteredPosition(input);
    }

    // super.solve(input, cameraTransform, isVR, isSelfAvatar);
    this.isVR = isVR;
    this.isSelfAvatar = isSelfAvatar;
    this.isNPC = isNPC;
    this.avatarRoot.getWorldPosition(this.avatarRootWorldPos);
    this.updateCurrentInput(input, cameraTransform);

    if (!isNPC) this.adjustEffectorPosition(input); // TODO: remove `if (!isNPC)`

    this.effector.updateMatrix();

    for (let _ = 0; _ < 2; _++) {
      this.base?.ikSolver?.alignBoneWithGoal(this.currentInputPosition);
      this.elbow?.ikSolver?.alignBoneWithGoal(this.currentInputPosition);
    }

    this.adjustElbow();

    // Write the hand orientation only once the arm chain has settled, so it does not lag the arm
    if (!isNPC) this.adjustEffectorTransform(input); // TODO: remove `if (!isNPC)`
  }
}
