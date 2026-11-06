import { Object3D, Vector3 } from "three";
import { InputTransform } from "../bit-systems/avatar-bones-system";
import { applyToBones, readRestFrames } from "../avatar/ik/apply-to-bones";
import { recalibrate as resetHeightCalibration } from "../avatar/ik/calibration";
import { BoneWrites, createBoneWrites, createIkState, IkState, solveBody } from "../avatar/ik/solve-body";
import { TrackedPose } from "../avatar/pose/tracked-pose";
import { RigDescription } from "../avatar/rig/rig-description";
import { Transform } from "../types/transform";
import { HeadIk } from "./avatar-ik/head-ik";
import { ArmIk } from "./avatar-ik/arm-ik";
import { LegIk } from "./avatar-ik/leg-ik";
import { JointSettings } from "./avatar-ik/joint-settings";
import { AvatarAnimState } from "../types/avatar-types";

const SelfHipsPositionOffset = new Vector3(0, 0, -0.1);
const SelfHipsPositionFlippedOffset = new Vector3(0, 0, 0.1);
const hipsPositionOffset = new Vector3();

const DummyInputTransform = {
  pos: { x: 0, y: 0, z: 0 },
  rot: { x: 0, y: 0, z: 0 }
};

export class AvatarIkManager {
  private isVR: boolean;
  private animState: AvatarAnimState;
  private isFlippedY: boolean;
  private rootBone: Object3D | undefined;
  private rootPos: Vector3;
  private rootInput: Transform | undefined;
  private hipsBone: Object3D | undefined;
  private isInputReady: boolean;
  private isSelfAvatar: boolean;
  private isHalfBody: boolean;
  private isNPC: boolean;
  private hips2HeadDist: number;

  private headIK: HeadIk;
  private leftArmIK: ArmIk;
  private rightArmIK: ArmIk;
  private leftLegIK: LegIk;
  private rightLegIK: LegIk;
  private poseInput: InputTransform;

  private leftFootWorldInput: Transform;
  private rightFootWorldInput: Transform;

  /** The new solver's state and output, created the first time the preference selects it */
  private rig: RigDescription;
  private ikState: IkState | undefined;
  private boneWrites: BoneWrites | undefined;
  private usesNewSolver: boolean | undefined;

  /** Takes the bones and the measurements of the rig as they were described when the model was loaded */
  constructor(rig: RigDescription, isNPC?: boolean) {
    const bone = (name: keyof RigDescription["bones"]) => rig.bones[name] ?? undefined;
    this.rig = rig;
    const head = bone("head");
    const spine = bone("spine");
    this.hipsBone = bone("hips");
    const left = bone("leftHand");
    const right = bone("rightHand");
    const leftFoot = bone("leftFoot");
    const rightFoot = bone("rightFoot");

    this.isVR = false;
    this.animState = 0; // avatar anim state TODO: change number to type AvatarAnimState
    this.isFlippedY = rig.isFlippedY;
    this.rootBone = bone("root");
    this.rootPos = new Vector3();
    this.isInputReady = false;
    this.isSelfAvatar = false;
    this.isNPC = isNPC || false;
    this.poseInput = {
      rig: DummyInputTransform,
      hmd: DummyInputTransform,
      leftController: DummyInputTransform,
      rightController: DummyInputTransform
    };

    this.hips2HeadDist = rig.lengths.hipsToHead;
    this.isHalfBody = rig.isHalfBody;

    this.stand();

    if (this.rootBone && this.hipsBone) {
      if (this.rootBone.parent) this.rootBone.parent.visible = false;

      if (head) {
        this.headIK = new HeadIk(
          this.rootBone,
          this.hipsBone,
          { bone: spine, ...JointSettings.head.base },
          { bone: bone("neck"), ...JointSettings.head.elbow },
          head,
          this.isFlippedY
        );
      }
      if (left) {
        this.leftArmIK = new ArmIk(
          this.rootBone,
          this.hipsBone,
          { bone: bone("leftUpperArm"), ...JointSettings.leftArm.base },
          { bone: bone("leftLowerArm"), ...JointSettings.leftArm.elbow },
          left,
          this.isFlippedY,
          true,
          this.isHalfBody
          // true
        );
      }
      if (right) {
        this.rightArmIK = new ArmIk(
          this.rootBone,
          this.hipsBone,
          { bone: bone("rightUpperArm"), ...JointSettings.rightArm.base },
          { bone: bone("rightLowerArm"), ...JointSettings.rightArm.elbow },
          right,
          this.isFlippedY,
          false,
          this.isHalfBody,
          true
        );
      }
      if (leftFoot) {
        this.leftLegIK = new LegIk(
          this.rootBone,
          this.hipsBone,
          { bone: bone("leftUpperLeg"), ...JointSettings.leftLeg.base },
          { bone: bone("leftLowerLeg"), ...JointSettings.leftLeg.elbow },
          leftFoot,
          this.isFlippedY,
          true
        );
      }
      if (rightFoot) {
        this.rightLegIK = new LegIk(
          this.rootBone,
          this.hipsBone,
          { bone: bone("rightUpperLeg"), ...JointSettings.rightLeg.base },
          { bone: bone("rightLowerLeg"), ...JointSettings.rightLeg.elbow },
          rightFoot,
          this.isFlippedY,
          false
        );
      }
    }
  }

  /** Solves the avatar from the tracked pose of the client it shows; the own avatar is told by its client id */
  updateAvatarBoneIkById(pose: TrackedPose, clientId: string) {
    const animState = pose.animState;
    this.poseInput.rig = pose.rig;
    this.poseInput.hmd = pose.head;
    this.poseInput.leftController = pose.leftHand;
    this.poseInput.rightController = pose.rightHand;
    this.isSelfAvatar = clientId === APP.sfu.clientId;
    this.isVR = pose.isVR;
    if (this.animState !== animState) {
      switch (animState) {
        case AvatarAnimState.STAND:
          this.stand();
          break;
        case AvatarAnimState.WALK:
          this.walk();
          break;
        case AvatarAnimState.SIT:
          this.sit();
          break;
        default:
          break;
      }
      this.animState = animState;
    }

    const useNewSolver = !!APP.store.state.preferences.avatarIkV2;
    if (useNewSolver !== this.usesNewSolver) {
      this.usesNewSolver = useNewSolver;
      console.log(`Avatar of ${clientId}: solving with the ${useNewSolver ? "new" : "old"} body solver`);
    }
    if (useNewSolver) this.solveWithNewSolver(pose);
    else this.updateAvatarBoneIk(this.poseInput);
  }

  /** The new path: a pure solve over the rig description and the tracked pose, then one write to the bones */
  private solveWithNewSolver(pose: TrackedPose) {
    if (!this.rootBone || !this.hipsBone) return;
    this.isInputReady = true;
    if (this.rootBone.parent && !this.rootBone.parent.visible) this.rootBone.parent.visible = true;
    if (!this.ikState || !this.boneWrites) {
      this.ikState = createIkState(readRestFrames(this.rig));
      this.boneWrites = createBoneWrites();
    }
    solveBody(this.rig, pose, this.ikState, this.boneWrites, { now: performance.now(), isSelf: this.isSelfAvatar });
    applyToBones(this.rig, this.boneWrites);
  }

  /** Forgets the new solver's height calibration, so the next frame in VR takes it again */
  recalibrate() {
    if (this.ikState) resetHeightCalibration(this.ikState.calibration);
  }

  updateAvatarBoneIk(poseInput: InputTransform) {
    if (!this.rootBone || !poseInput) return;
    this.isInputReady = true;

    // TODO: emit event so that name tag can initialize its position
    if (!this.isInputReady) return;
    if (this.rootBone.parent && !this.rootBone.parent?.visible) this.rootBone.parent.visible = true;

    this.rootInput = poseInput.rig;
    if (!this.isNPC) this.updateRootAndHipsTransform(poseInput.hmd);

    this.headIK?.solve(poseInput.hmd, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);
    this.leftArmIK?.solve(poseInput.leftController, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);
    this.rightArmIK?.solve(poseInput.rightController, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);

    // if (!this.isNPC && this.leftFootWorldInput)
    this.leftLegIK?.solve(this.leftFootWorldInput, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);
    // if (!this.isNPC && this.rightFootWorldInput)
    this.rightLegIK?.solve(this.rightFootWorldInput, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);

    if (this.isVR) this.rootBone?.updateWorldMatrix(false, true);
  }

  private updateRootAndHipsTransform(hmdTransform: Transform | undefined) {
    if (!this.rootInput || !hmdTransform) return;

    if (this.rootBone) {
      this.rootBone.position.set(this.rootInput.pos.x, this.rootInput.pos.y, this.rootInput.pos.z);
      this.rootBone.rotation.set(this.rootInput.rot.x, this.rootInput.rot.y, 0 /* this.rootInput.rot.z */);
      this.rootBone.rotation._onChangeCallback();
      this.rootBone.updateMatrix();
      this.rootBone.getWorldPosition(this.rootPos);
    }

    if (this.hipsBone) {
      this.hipsBone.position.set(
        this.isVR ? hmdTransform.pos.x : 0,
        hmdTransform.pos.y - this.hips2HeadDist - 0.05,
        this.isVR ? hmdTransform.pos.z : 0
      );
      if (this.isSelfAvatar) {
        this.hipsBone.position.add(
          hipsPositionOffset
            .copy(this.isFlippedY ? SelfHipsPositionFlippedOffset : SelfHipsPositionOffset)
            .applyQuaternion(this.hipsBone.quaternion)
        );
      }
      this.hipsBone.rotation.set(0, (hmdTransform?.rot.y || 0) + (this.isFlippedY ? 0 : Math.PI), 0);
      this.hipsBone.rotation._onChangeCallback();
      this.hipsBone.updateMatrix();
    }
  }

  stand() {
    this.leftFootWorldInput = {
      pos: { x: 0.1, y: 0, z: 0 },
      rot: { x: -1, y: 0, z: 0 }
    };
    this.rightFootWorldInput = {
      pos: { x: -0.1, y: 0, z: 0 },
      rot: { x: -1, y: 0, z: 0 }
    };
  }

  // Walking is not implemented: the feet keep the targets of the current standing or sitting pose
  walk() {}

  sit() {
    this.leftFootWorldInput = {
      pos: { x: 0.1, y: 0.3, z: 0.4 },
      rot: { x: -1, y: 0, z: 0 }
    };
    this.rightFootWorldInput = {
      pos: { x: -0.1, y: 0.3, z: 0.4 },
      rot: { x: -1, y: 0, z: 0 }
    };
  }
}
