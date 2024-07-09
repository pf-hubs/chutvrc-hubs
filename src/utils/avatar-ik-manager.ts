import { Object3D, Vector3 } from "three";
import { HubsWorld } from "../app";
import { AvatarComponent } from "../bit-components";
import { InputTransform, InputTransformById } from "../bit-systems/avatar-bones-system";
import { Position, Transform } from "../types/transform";
import { HeadIk } from "./avatar-ik/head-ik";
import { ArmIk } from "./avatar-ik/arm-ik";
import { LegIk } from "./avatar-ik/leg-ik";
import { JointSettings } from "./avatar-ik/joint-settings";

const SelfHipsPositionOffset = new Vector3(0, 0, -0.1);
const SelfHipsPositionFlippedOffset = new Vector3(0, 0, 0.1);

const DummyInputTransform = {
  pos: { x: 0, y: 0, z: 0 },
  rot: { x: 0, y: 0, z: 0 }
};

export class AvatarIkManager {
  private world: HubsWorld;
  private isVR: boolean;
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

  private rootPosBeforeWalk: Position;
  private isWalking: boolean;
  private walkingTimer = 0;
  private leftFootTarget: Object3D;
  private rightFootTarget: Object3D;
  private leftFootWorldPosBuffer: Vector3;
  private rightFootWorldPosBuffer: Vector3;
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

    this.world = world;
    this.isVR = false;
    this.isFlippedY = (right?.position?.x || 0) - (left?.position?.x || 0) > 0;
    this.rootBone = world.eid2obj.get(AvatarComponent.root[avatarEid]);
    this.rootPos = new Vector3();
    this.isInputReady = false;
    this.isSelfAvatar = false;
    this.isNPC = isNPC || false;

    let headWorldPos = new Vector3();
    let hipsWorldPos = new Vector3();
    head?.getWorldPosition(headWorldPos);
    this.hipsBone?.getWorldPosition(hipsWorldPos);
    this.hips2HeadDist = (headWorldPos.y || 1) - (hipsWorldPos.y || 0);

    this.isHalfBody = left?.parent === spine && right?.parent === spine && spine?.parent === this.hipsBone;

    this.leftFootTarget = new Object3D();
    this.rightFootTarget = new Object3D();
    this.leftFootWorldPosBuffer = new Vector3();
    this.rightFootWorldPosBuffer = new Vector3();
    if (this.rootBone) {
      this.leftFootTarget.parent = this.rootBone;
      this.leftFootTarget.position.set(-0.1, -0.5, 0);
      this.leftFootTarget.updateMatrix();

      this.rightFootTarget.parent = this.rootBone;
      this.rightFootTarget.position.set(0.1, -0.5, 0);
      this.rightFootTarget.updateMatrix();
    }
    this.leftFootWorldInput = { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } };
    this.rightFootWorldInput = { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } };

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
          this.isHalfBody,
          this.world
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
          this.world,
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

    this.rootPosBeforeWalk = { x: 0, y: 0, z: 0 };
  }

  updateAvatarBoneIkById(poseInputs: InputTransformById, clientId: string, isVr: boolean) {
    const poseInput: InputTransform = {
      rig: poseInputs.rig?.get(clientId) || DummyInputTransform,
      hmd: poseInputs.hmd?.get(clientId) || DummyInputTransform,
      leftController: poseInputs.leftController?.get(clientId) || DummyInputTransform,
      rightController: poseInputs.rightController?.get(clientId) || DummyInputTransform
    };
    this.isSelfAvatar = clientId === APP.sfu._clientId;
    this.isVR = isVr;

    this.updateAvatarBoneIk(poseInput);
  }

  updateAvatarBoneIk(poseInput: InputTransform) {
    if (!this.rootBone || !poseInput) return;
    this.isInputReady = true;

    // TODO: emit event so that name tag can initialize its position
    if (!this.isInputReady) return;
    if (this.rootBone.parent && !this.rootBone.parent?.visible) this.rootBone.parent.visible = true;

    // this.handleWalkingState(poseInput.rig.pos);

    this.rootInput = poseInput.rig;
    if (!this.isNPC) this.updateRootAndHipsTransform(poseInput.hmd);

    this.headIK?.solve(poseInput.hmd, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);
    this.leftArmIK?.solve(poseInput.leftController, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);
    this.rightArmIK?.solve(poseInput.rightController, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);
    /*
    if (!this.isNPC && this.leftFootWorldInput)
      this.leftLegIK?.solve(this.leftFootWorldInput, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);
    if (!this.isNPC && this.rightFootWorldInput)
      this.rightLegIK?.solve(this.rightFootWorldInput, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);
    */

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
          (this.isFlippedY ? SelfHipsPositionFlippedOffset : SelfHipsPositionOffset)
            .clone()
            .applyQuaternion(this.hipsBone.quaternion)
        );
      }
      this.hipsBone.rotation.set(0, (hmdTransform?.rot.y || 0) + (this.isFlippedY ? 0 : Math.PI), 0);
      this.hipsBone.rotation._onChangeCallback();
      this.hipsBone.updateMatrix();
    }
  }

  private handleWalkingState(inputRigPos: Position) {
    if (!this.leftFootTarget || !this.rightFootTarget) return;
    if (this.isWalking) {
      if (this.rootInput && this.rootInput.pos.x === inputRigPos.x && this.rootInput.pos.z === inputRigPos.z) {
        this.isWalking = false;
        this.rootPosBeforeWalk = inputRigPos;
        this.leftFootTarget.position.set(-0.1, -0.5, 0);
        this.rightFootTarget.position.set(0.1, -0.5, 0);
      } else {
        this.walkingTimer += 0.005;
        this.leftFootTarget.position.set(-0.1, -0.5, Math.sin(this.walkingTimer));
        this.rightFootTarget.position.set(0.1, -0.5, Math.cos(this.walkingTimer));
      }

      this.leftFootTarget.getWorldPosition(this.leftFootWorldPosBuffer);
      this.rightFootTarget.getWorldPosition(this.rightFootWorldPosBuffer);
      this.leftFootWorldInput.pos = {
        x: this.leftFootWorldPosBuffer.x,
        y: this.leftFootWorldPosBuffer.y,
        z: this.leftFootWorldPosBuffer.z
      };
      this.leftFootWorldInput.pos = {
        x: this.rightFootWorldPosBuffer.x,
        y: this.rightFootWorldPosBuffer.y,
        z: this.rightFootWorldPosBuffer.z
      };
    } else if (
      Math.abs(this.rootPosBeforeWalk.x - inputRigPos.x) > 0.1 ||
      Math.abs(this.rootPosBeforeWalk.z - inputRigPos.z) > 0.1
    ) {
      this.isWalking = true;
    }
  }
}
