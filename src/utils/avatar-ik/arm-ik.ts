import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { Transform } from "../../types/transform";
import { JointInitSettings, LimbIk } from "./limb-ik";
import { HubsWorld } from "../../app";
import { TransformLowPassFilter } from "../transform-low-pass-filter";

const VECTOR_UP = new Vector3(0, 1, 0);

export class ArmIk extends LimbIk {
  private isDebug?: boolean;
  private isLeft: boolean;
  private isHalfBody: boolean;
  private world: HubsWorld;
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
    world: HubsWorld,
    isDebug?: boolean
  ) {
    super(avatarRootBone, avatarHipsBone, base, elbow, effector, isFlippedY);

    if (this.elbow) {
      this.elbow.isYRotFixed = true;
      this.elbow.ikSolver.setYRotFixedFlag(true);
    }
    this.isLeft = isLeft;
    this.isHalfBody = isHalfBody;
    this.world = world;
    this.inputFilter = new TransformLowPassFilter(0.3, 0.3);
    this.isDebug = isDebug;
    this.elbow.bone.rotation.order = "XZY";
    this.effector.rotation.order = "YXZ";
  }

  protected override updateCurrentInput(input: Transform | null, cameraTransform: Transform) {
    this.currentInputPosition
      .set(
        input && this.isVR ? -input.pos.x : this.isLeft ? 0.3 : -0.3,
        input && this.isVR ? input.pos.y : 0.9,
        input && this.isVR ? -input.pos.z : 0
      )
      .applyAxisAngle(VECTOR_UP, this.avatarRoot.rotation.y - Math.PI + (this.isVR ? 0 : cameraTransform.rot.y))
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

  protected override adjustEffectorTransform(input: Transform | null) {
    if (input && this.isVR && this.avatarRoot) {
      let parent = this.effector.parent;
      let targetQ = new Quaternion();
      targetQ.setFromEuler(new Euler(input.rot.x, input.rot.y, input.rot.z, "YXZ"));

      // Attach hand to scene -> apply world transform -> attach back to original parent
      this.world.scene.attach(this.effector);
      if (this.isHalfBody) {
        // world position
        this.effector.position.copy(this.currentInputPosition);
      }
      this.effector.quaternion.copy(this.avatarRoot?.quaternion.clone().multiply(targetQ) || targetQ); // world rotation
      this.effector.quaternion._onChangeCallback();
      this.effector.updateMatrix();
      parent?.attach(this.effector);

      if (this.isFlippedY) {
        this.effector.rotateZ(this.isLeft ? Math.PI / 2 : -Math.PI / 2);
        this.effector.rotateY(this.isLeft ? -Math.PI / 2 : Math.PI / 2);
      } else {
        this.effector.rotateX(-Math.PI / 3);
        this.effector.rotateY(this.isLeft ? Math.PI / 2 : -Math.PI / 2);
      }
    } else {
      this.effector.rotation.set(0, 0, 0);
    }

    this.effector.rotation._onChangeCallback();
    this.effector.updateMatrix();
  }

  override solve(input: Transform | null, cameraTransform: Transform, isVR: boolean, isSelfAvatar: boolean) {
    if (input && isVR && !this.isHalfBody) {
      input = this.inputFilter.getTransformWithFilteredPosition(input);
    }

    // super.solve(input, cameraTransform, isVR, isSelfAvatar);
    this.isVR = isVR;
    this.isSelfAvatar = isSelfAvatar;
    this.avatarRoot.getWorldPosition(this.avatarRootWorldPos);
    this.updateCurrentInput(input, cameraTransform);

    this.adjustEffectorTransform(input);

    const rotY = this.effector.rotation.y;
    // this.effector.rotation.y = 0;
    // this.effector.updateMatrix();

    for (let _ = 0; _ < 2; _++) {
      this.base?.ikSolver?.alignBoneWithGoal(this.currentInputPosition);
      this.elbow?.ikSolver?.alignBoneWithGoal(this.currentInputPosition, rotY);
    }

    this.adjustElbow();
  }
}
