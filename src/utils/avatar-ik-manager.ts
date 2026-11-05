import { Object3D, Vector3 } from "three";
import { HubsWorld } from "../app";
import { AvatarComponent } from "../bit-components";
import { InputTransform } from "../bit-systems/avatar-bones-system";
import { TrackedPose } from "../avatar/pose/tracked-pose";
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

  constructor(world: HubsWorld, avatarEid: number, isNPC?: boolean) {
    const head = world.eid2obj.get(AvatarComponent.head[avatarEid]);
    const spine = world.eid2obj.get(AvatarComponent.spine[avatarEid]);
    this.hipsBone = world.eid2obj.get(AvatarComponent.hips[avatarEid]);
    const left = world.eid2obj.get(AvatarComponent.leftHand[avatarEid]);
    const right = world.eid2obj.get(AvatarComponent.rightHand[avatarEid]);
    const leftFoot = world.eid2obj.get(AvatarComponent.leftFoot[avatarEid]);
    const rightFoot = world.eid2obj.get(AvatarComponent.rightFoot[avatarEid]);

    this.isVR = false;
    this.animState = 0; // avatar anim state TODO: change number to type AvatarAnimState
    this.isFlippedY = (right?.position?.x || 0) - (left?.position?.x || 0) > 0;
    this.rootBone = world.eid2obj.get(AvatarComponent.root[avatarEid]);
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

    let headWorldPos = new Vector3();
    let hipsWorldPos = new Vector3();
    head?.getWorldPosition(headWorldPos);
    this.hipsBone?.getWorldPosition(hipsWorldPos);
    this.hips2HeadDist = (headWorldPos.y || 1) - (hipsWorldPos.y || 0);

    this.isHalfBody = left?.parent === spine && right?.parent === spine && spine?.parent === this.hipsBone;

    this.stand();

    if (this.rootBone && this.hipsBone) {
      if (this.rootBone.parent) this.rootBone.parent.visible = false;

      if (head) {
        this.headIK = new HeadIk(
          this.rootBone,
          this.hipsBone,
          { bone: spine, ...JointSettings.head.base },
          { bone: world.eid2obj.get(AvatarComponent.neck[avatarEid]), ...JointSettings.head.elbow },
          head,
          this.isFlippedY
        );
      }
      if (left) {
        this.leftArmIK = new ArmIk(
          this.rootBone,
          this.hipsBone,
          { bone: world.eid2obj.get(AvatarComponent.leftUpperArm[avatarEid]), ...JointSettings.leftArm.base },
          { bone: world.eid2obj.get(AvatarComponent.leftLowerArm[avatarEid]), ...JointSettings.leftArm.elbow },
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
          { bone: world.eid2obj.get(AvatarComponent.rightUpperArm[avatarEid]), ...JointSettings.rightArm.base },
          { bone: world.eid2obj.get(AvatarComponent.rightLowerArm[avatarEid]), ...JointSettings.rightArm.elbow },
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
          { bone: world.eid2obj.get(AvatarComponent.leftUpperLeg[avatarEid]), ...JointSettings.leftLeg.base },
          { bone: world.eid2obj.get(AvatarComponent.leftLowerLeg[avatarEid]), ...JointSettings.leftLeg.elbow },
          leftFoot,
          this.isFlippedY,
          true
        );
      }
      if (rightFoot) {
        this.rightLegIK = new LegIk(
          this.rootBone,
          this.hipsBone,
          { bone: world.eid2obj.get(AvatarComponent.rightUpperLeg[avatarEid]), ...JointSettings.rightLeg.base },
          { bone: world.eid2obj.get(AvatarComponent.rightLowerLeg[avatarEid]), ...JointSettings.rightLeg.elbow },
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

    this.updateAvatarBoneIk(this.poseInput);
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
