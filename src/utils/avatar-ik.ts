import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { BoneType } from "../constants";
import { HubsWorld } from "../app";
import { AvatarComponent } from "../bit-components";
import { InputTransform, InputTransformById } from "../bit-systems/avatar-bones-system";

const FULL_BODY_HEAD_OFFSET = 0.25;
const VECTOR_UP = new Vector3(0, 1, 0);

const HAND_ROTATIONS = {
  left: new Quaternion().setFromEuler(new Euler(-Math.PI / 2, Math.PI / 2, 0)),
  right: new Quaternion().setFromEuler(new Euler(-Math.PI / 2, -Math.PI / 2, 0))
};

const HAND_ROTATIONS_MATRIX = {
  left: new Matrix4().makeRotationFromEuler(new Euler(-Math.PI / 2, Math.PI / 2, 0)),
  right: new Matrix4().makeRotationFromEuler(new Euler(-Math.PI / 2, -Math.PI / 2, 0))
};

const DummyInputTransform = {
  pos: { x: 0, y: 0, z: 0 },
  rot: { x: 0, y: 0, z: 0 }
};

type Vector3Type = { x: number; y: number; z: number };
type QuaternionType = { x: number; y: number; z: number };
type Transform = { pos: Vector3Type; rot: QuaternionType };

// Ref: https://scrapbox.io/ke456memo/%2327_pixiv%2Fthree-vrm%E3%81%A7VRM%E3%81%AB%E5%AF%BE%E5%BF%9C%E3%81%97%E3%81%9FIK%E3%82%92%E5%AE%9F%E8%A3%85%E3%81%99%E3%82%8B
const alignBoneWithTarget = (
  joint: Object3D,
  effector: Object3D,
  target: Vector3,
  rotationMin: Vector3,
  rotationMax: Vector3
) => {
  let bonePosition = new Vector3();
  let boneQuaternionInverse = new Quaternion();
  let effectorPosition = new Vector3();
  let bone2EffectorVector = new Vector3();
  let bone2GoalVector = new Vector3();
  let axis = new Vector3();
  let quarternion = new Quaternion();

  joint.getWorldPosition(bonePosition);
  joint.getWorldQuaternion(boneQuaternionInverse);
  boneQuaternionInverse.invert();

  effector.getWorldPosition(effectorPosition);
  bone2EffectorVector.subVectors(effectorPosition, bonePosition);
  bone2EffectorVector.applyQuaternion(boneQuaternionInverse);
  bone2EffectorVector.normalize();

  bone2GoalVector.subVectors(target, bonePosition);
  bone2GoalVector.applyQuaternion(boneQuaternionInverse);
  bone2GoalVector.normalize();

  let deltaAngle = bone2GoalVector.dot(bone2EffectorVector);
  if (deltaAngle > 1.0) {
    deltaAngle = 1.0;
  } else if (deltaAngle < -1.0) {
    deltaAngle = -1.0;
  }
  deltaAngle = Math.acos(deltaAngle);

  axis.crossVectors(bone2EffectorVector, bone2GoalVector);
  axis.normalize();

  quarternion.setFromAxisAngle(axis, deltaAngle);

  joint.quaternion.multiply(quarternion);
  let euler = new Euler().setFromQuaternion(joint.quaternion);
  euler.x = Math.max(rotationMin.x, Math.min(rotationMax.x, euler.x));
  euler.y = Math.max(rotationMin.y, Math.min(rotationMax.y, euler.y));
  euler.z = Math.max(rotationMin.z, Math.min(rotationMax.z, euler.z));
  joint.quaternion.setFromEuler(euler);

  joint.rotation._onChangeCallback();
  joint.updateMatrix();
  joint.updateMatrixWorld(true);
};

export class AvatarIk {
  private world: HubsWorld;
  private isFlippedY: boolean;
  private hipsBone: Object3D | undefined;
  private hips2HeadDist: number;
  private rootBone: Object3D | undefined;
  private rootPos: Vector3;
  private rootRot: Quaternion;
  private rootInput: Transform | undefined;
  private currentJoint: Object3D | undefined;
  private currentInputPosition: Vector3;
  private isWalking: boolean;
  private isInputReady: boolean;
  private isSelfAvatar: boolean;
  private headEffectorOffset: Vector3;
  private waitTime: number;
  private walkTimer: number;
  private leftFootWalkPosZ: number;
  private rightFootWalkPosZ: number;
  private lastRootPosInputX: number;
  private lastRootPosInputZ: number;
  private isMoving: boolean;
  private walkingStatusBuffer: boolean[];

  constructor(world: HubsWorld, avatarEid: number) {
    const leftHandX = APP.world.eid2obj.get(AvatarComponent.leftHand[avatarEid])?.position?.x || 0;
    const rightHandX = APP.world.eid2obj.get(AvatarComponent.rightHand[avatarEid])?.position?.x || 0;

    this.world = world;
    this.isFlippedY = rightHandX - leftHandX > 0;
    this.hipsBone = world.eid2obj.get(AvatarComponent.hips[avatarEid]);
    this.rootBone = world.eid2obj.get(AvatarComponent.root[avatarEid]);
    this.rootPos = new Vector3();
    this.rootRot = new Quaternion();
    this.currentInputPosition = new Vector3();
    this.isWalking = false;
    this.isInputReady = false;
    this.isSelfAvatar = false;
    this.headEffectorOffset = new Vector3(0, 0, 0);
    this.waitTime = 0;
    this.walkTimer = 0;
    this.leftFootWalkPosZ = 0;
    this.rightFootWalkPosZ = 0;
    this.lastRootPosInputX = 0;
    this.lastRootPosInputZ = 0;
    this.isMoving = false;
    this.walkingStatusBuffer = [false, false, false];

    let headPos = new Vector3();
    APP.world.eid2obj.get(AvatarComponent.head[avatarEid])?.getWorldPosition(headPos);
    let hipsPos = new Vector3();
    this.hipsBone?.getWorldPosition(hipsPos);
    this.hips2HeadDist = hipsPos && headPos ? headPos.y - hipsPos.y : 0;

    if (this.rootBone) {
      if (this.rootBone.parent) this.rootBone.parent.visible = false;
      this.lastRootPosInputX = this.rootBone.position.x;
      this.lastRootPosInputZ = this.rootBone.position.z;
    }
  }

  updateAvatarBoneIkById(avatarEid: number, poseInputs: InputTransformById, clientId = "", deltaTime = 0) {
    const poseInput: InputTransform = {
      rig: poseInputs.rig?.get(clientId) || DummyInputTransform,
      hmd: poseInputs.hmd?.get(clientId) || DummyInputTransform,
      leftController: poseInputs.leftController?.get(clientId) || DummyInputTransform,
      rightController: poseInputs.rightController?.get(clientId) || DummyInputTransform
    };
    this.isSelfAvatar = clientId === APP.sfu._clientId;
    this.updateAvatarBoneIk(avatarEid, poseInput, deltaTime);
  }

  updateAvatarBoneIk(avatarEid: number, poseInput: InputTransform, deltaTime = 0) {
    if (!this.rootBone || !poseInput) return;
    this.isInputReady = true;
    // TODO: emit event so that name tag can initialize its position
    if (!this.isInputReady) return;
    this.waitTime += deltaTime;
    if (this.waitTime < 2000) return;
    if (this.rootBone.parent && !this.rootBone.parent?.visible) this.rootBone.parent.visible = true;

    this.rootInput = poseInput.rig;
    this.updateRootHipsBone(
      poseInput.hmd,
      AvatarComponent.leftFoot[avatarEid] === 0 && AvatarComponent.rightFoot[avatarEid] === 0,
      deltaTime
    );

    this.rootBone.getWorldPosition(this.rootPos);
    this.rootBone.getWorldQuaternion(this.rootRot);

    for (let i = 0; i < defaultIKConfig.iteration; i++) {
      defaultIKConfig.chainConfigs.forEach(chainConfig => {
        this.updateEffectorAndJoint(avatarEid, poseInput, chainConfig);
      });
    }

    this.walkingStatusBuffer.push(this.isMoving || this.isWalking);
    this.walkingStatusBuffer.shift();
    if (this.walkingStatusBuffer.every(isWalking => !isWalking)) {
      this.stopWalk();
    } else {
      this.walk(deltaTime);
    }
  }

  private updateRootHipsBone(hmdTransform: Transform | undefined, noLegs = false, deltaTime = 0) {
    if (!this.rootInput) return;
    // this.rootBone?.position.set(this.rootInput.pos.x, this.rootInput.pos.y + (noLegs ? 1 : 0), this.rootInput.pos.z);
    this.rootBone?.position.set(
      this.rootInput.pos.x,
      this.rootInput.pos.y,
      this.rootInput.pos.z /* + (this.isSelfAvatar ? FULL_BODY_HEAD_OFFSET * (this.isFlippedY ? 0.01 : -0.01) : 0)*/
    );
    this.isMoving =
      Math.abs(this.lastRootPosInputX - this.rootInput.pos.x) > 0.03 ||
      Math.abs(this.lastRootPosInputZ - this.rootInput.pos.z) > 0.03;
    this.lastRootPosInputX = this.rootInput.pos.x;
    this.lastRootPosInputZ = this.rootInput.pos.z;
    // if (this.isSelfAvatar) {
    //   this.rootBone?.position.add(this.headEffectorOffset.clone().multiplyScalar(this.isFlippedY ? 0.01 : -0.01));
    // }
    this.rootBone?.rotation.set(
      this.rootInput.rot.y,
      this.rootInput.rot.x + (hmdTransform?.rot.x || 0) + (this.isFlippedY ? 0 : Math.PI),
      this.rootInput.rot.z
    );
    this.rootBone?.rotation._onChangeCallback();
    this.rootBone?.updateMatrix();

    if (this.hipsBone && hmdTransform) {
      const isHipsFarFromHead =
        Math.abs(hmdTransform.pos.x - this.hipsBone.position.x) > 0.15 ||
        Math.abs(hmdTransform.pos.z - this.hipsBone.position.z) > 0.15;
      let hipsBonePosX = this.hipsBone.position.x;
      let hipsBonePosZ = this.hipsBone.position.z;
      if (this.isWalking) {
        if (isHipsFarFromHead) {
          hipsBonePosX =
            this.hipsBone.position.x +
            ((this.isFlippedY ? hmdTransform.pos.x : -hmdTransform.pos.x) > this.hipsBone.position.x
              ? 0.0001
              : -0.0001) *
              deltaTime;
          hipsBonePosZ =
            this.hipsBone.position.z +
            ((this.isFlippedY ? hmdTransform.pos.z : -hmdTransform.pos.z) > this.hipsBone.position.z
              ? 0.0001
              : -0.0001) *
              deltaTime;
        } else {
          this.isWalking = false;
        }
      } else if (isHipsFarFromHead) {
        this.isWalking = true;
      }
      this.hipsBone.position.set(hipsBonePosX, hmdTransform.pos.y - this.hips2HeadDist - 0.15, hipsBonePosZ);
    }
  }

  private updateEffectorAndJoint(avatarEid: number, poseInput: InputTransform, chainConfig: any) {
    const effector = this.world.eid2obj.get(chainConfig.effectorBoneAsAvatarProp[avatarEid]);
    if (!effector) return;

    let targetRot = { x: 0, y: 0, z: 0 };

    for (let _ = 0; _ < 2; _++) {
      chainConfig.jointConfigs.forEach((jointConfig: any) => {
        this.currentJoint = this.world.eid2obj.get(jointConfig.boneAsAvatarProp[avatarEid]);
        if (this.currentInputPosition && this.currentJoint && effector) {
          const followHeadVerticalRotation = this.getEffectorInputPosition(chainConfig.effectorBoneName, poseInput);
          const isSelfHead = this.isSelfAvatar && chainConfig.effectorBoneName === BoneType.Head;
          if (isSelfHead) {
            effector.getWorldDirection(this.headEffectorOffset);
            this.headEffectorOffset
              .projectOnPlane(VECTOR_UP)
              .multiplyScalar(FULL_BODY_HEAD_OFFSET * (this.isFlippedY ? 1 : -1));
          }
          if (this.currentInputPosition && this.rootBone && this.rootInput) {
            alignBoneWithTarget(
              this.currentJoint,
              effector,
              this.currentInputPosition
                .applyAxisAngle(
                  this.rootBone.up,
                  this.rootInput.rot.x - Math.PI + (followHeadVerticalRotation ? poseInput.hmd?.rot?.x || 0 : 0)
                )
                .add(isSelfHead ? this.rootPos.clone().add(this.headEffectorOffset) : this.rootPos),
              jointConfig.rotationMin,
              jointConfig.rotationMax
            );
          }
        }
      });
    }

    var isHand = false;
    switch (chainConfig.effectorBoneName) {
      case BoneType.Head:
        targetRot = poseInput.hmd?.rot || targetRot;
        break;
      case BoneType.LeftHand:
        targetRot = poseInput.leftController?.rot || targetRot;
        isHand = true;
        break;
      case BoneType.RightHand:
        targetRot = poseInput.rightController?.rot || targetRot;
        isHand = true;
        break;
      default:
        break;
    }

    if (!isHand) {
      effector.rotation.set(
        this.isFlippedY ? targetRot.y : -targetRot.y,
        chainConfig.effectorBoneName === BoneType.Head ? 0 : targetRot.x,
        targetRot.z
      );
    } else if (this.rootBone) {
      // effector.rotation.set(targetRot.x, targetRot.y, targetRot.z, "YZX");
      effector.rotation.set(0, 0, 0);

      /*
      const lastJoint = this.world.eid2obj.get(AvatarComponent.spine[avatarEid]);
      if (!lastJoint) return;
      const handMatrix = effector.matrix;
      const rootToChest = new Matrix4();
      const invRootToChest = new Matrix4();
      rootToChest.multiplyMatrices(this.rootBone.matrix, lastJoint.matrix);
      invRootToChest.copy(rootToChest).invert();
      const controllerMatrix = new Matrix4().makeRotationFromEuler(new Euler(targetRot.x, targetRot.y, targetRot.z));
      handMatrix.multiplyMatrices(invRootToChest, controllerMatrix);
      handMatrix.multiply(HAND_ROTATIONS_MATRIX.left);
      effector.rotation.setFromRotationMatrix(handMatrix);
      */
    }

    effector.rotation._onChangeCallback();
    effector.updateMatrix();
  }

  private getEffectorInputPosition(effectorBoneName: any, poseInput: InputTransform) {
    let rawPos;
    let followHeadVerticalRotation = true;
    switch (effectorBoneName) {
      case BoneType.Head:
        followHeadVerticalRotation = false;
        rawPos = poseInput.hmd?.pos;
        // if (rawPos && this.isFlippedY) {
        //   rawPos = { x: -rawPos.x, y: rawPos.y, z: -rawPos.z };
        // }
        rawPos = { x: -rawPos.x, y: rawPos.y, z: -rawPos.z };
        break;
      case BoneType.LeftHand:
        rawPos = poseInput.leftController?.pos;
        if (rawPos) {
          if (rawPos.x == 0 && rawPos.y == 0 && rawPos.z == 0) {
            // if VR controller doesn't exist
            rawPos = { x: 0.5, y: 0.9, z: 0.1 };
          } else {
            // if VR controller exists
            followHeadVerticalRotation = false;
            // if (this.isFlippedY) {
            //   rawPos = { x: -rawPos.x, y: rawPos.y, z: -rawPos.z };
            // }
            rawPos = { x: -rawPos.x, y: rawPos.y, z: -rawPos.z };
          }
        }
        break;
      case BoneType.RightHand:
        rawPos = poseInput.rightController?.pos;
        if (rawPos) {
          if (rawPos.x == 0 && rawPos.y == 0 && rawPos.z == 0) {
            // if VR controller doesn't exist
            rawPos = { x: -0.5, y: 0.9, z: 0.1 };
          } else {
            // if VR controller exists
            followHeadVerticalRotation = false;
            // if (this.isFlippedY) {
            //   rawPos = { x: -rawPos.x, y: rawPos.y, z: -rawPos.z };
            // }
            rawPos = { x: -rawPos.x, y: rawPos.y, z: -rawPos.z };
          }
        }
        break;
      case BoneType.LeftFoot:
        var hipsPos = this.hipsBone?.position;
        if (hipsPos) {
          rawPos = {
            x: ((this.isFlippedY ? -hipsPos.x : hipsPos.x) || 0) + 0.1, // (this.isFlippedY ? 0.05 : -0.05),
            y: -0.05,
            z: (this.isFlippedY ? -(hipsPos.z + this.leftFootWalkPosZ) : hipsPos.z + this.leftFootWalkPosZ) || 0
          };
        } else {
          rawPos = { x: this.isFlippedY ? 0.1 : -0.1, y: 0, z: 0 };
        }
        // TODO: walk / run animation when foot moves with hmd
        // TODO: IK when tracker for foot exists (in such case: followHeadVerticalRotation = false)
        break;
      case BoneType.RightFoot:
        var hipsPos = this.hipsBone?.position;
        if (hipsPos) {
          rawPos = {
            x: ((this.isFlippedY ? -hipsPos.x : hipsPos.x) || 0) + -0.1, //(this.isFlippedY ? -0.05 : 0.05),
            y: -0.05,
            z: (this.isFlippedY ? -(hipsPos.z + this.rightFootWalkPosZ) : hipsPos.z + this.rightFootWalkPosZ) || 0
          };
        } else {
          rawPos = { x: this.isFlippedY ? -0.1 : 0.1, y: 0, z: 0 };
        }
        // TODO: walk / run animation when foot moves with hmd
        // TODO: IK when tracker for foot exists (in such case: followHeadVerticalRotation = false)
        break;
      default:
        break;
    }
    if (rawPos) {
      this.currentInputPosition.set(rawPos.x, rawPos.y, rawPos.z);
    }
    return followHeadVerticalRotation;
  }

  walk(deltaTime: number) {
    this.walkTimer += deltaTime * 0.01;
    this.leftFootWalkPosZ = Math.cos(this.walkTimer) * 0.1;
    this.rightFootWalkPosZ = -Math.cos(this.walkTimer) * 0.1;
  }

  stopWalk() {
    this.walkTimer = 0;
    this.leftFootWalkPosZ = 0;
    this.rightFootWalkPosZ = 0;
  }
}

const defaultIKConfig = {
  iteration: 3,
  chainConfigs: [
    // Hip -> Head
    {
      jointConfigs: [
        {
          boneName: BoneType.Neck,
          boneAsAvatarProp: AvatarComponent.neck,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI),
          followTargetRotation: false
        },
        {
          boneName: BoneType.Chest,
          boneAsAvatarProp: AvatarComponent.chest,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI),
          followTargetRotation: false
        },
        {
          boneName: BoneType.Spine,
          boneAsAvatarProp: AvatarComponent.spine,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI),
          followTargetRotation: false
        },
        {
          boneName: BoneType.Hips,
          boneAsAvatarProp: AvatarComponent.hips,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI),
          followTargetRotation: true
        }
      ],
      effectorBoneName: BoneType.Head,
      effectorBoneAsAvatarProp: AvatarComponent.head,
      effectorFollowTargetRotation: false
    },
    // Left Shoulder -> Hand
    {
      jointConfigs: [
        {
          boneName: BoneType.LeftLowerArm,
          boneAsAvatarProp: AvatarComponent.leftLowerArm,
          order: "YZX",
          // rotationMin: new Vector3(0, -Math.PI, 0),
          // rotationMax: new Vector3(0, -(0.1 / 180) * Math.PI, 0),
          rotationMin: new Vector3(0, 0, 0),
          rotationMax: new Vector3(0, Math.PI, Math.PI),
          followTargetRotation: false
        },
        {
          boneName: BoneType.LeftUpperArm,
          boneAsAvatarProp: AvatarComponent.leftUpperArm,
          order: "ZXY",
          rotationMin: new Vector3(-Math.PI / 2, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI / 2, Math.PI, Math.PI),
          followTargetRotation: false
        }
        // {
        //   boneName: BoneType.LeftShoulder,
        //   boneAsAvatarProp: AvatarComponent.leftShoulder,
        //   order: "ZXY",
        //   rotationMin: new Vector3(0, -(45 / 180) * Math.PI, -(45 / 180) * Math.PI),
        //   rotationMax: new Vector3(0, (45 / 180) * Math.PI, 0),
        //   followTargetRotation: false
        // }
      ],
      effectorBoneName: BoneType.LeftHand,
      effectorBoneAsAvatarProp: AvatarComponent.leftHand,
      effectorFollowTargetRotation: true
    },
    // Right Shoulder -> Hand
    {
      jointConfigs: [
        {
          boneName: BoneType.RightLowerArm,
          boneAsAvatarProp: AvatarComponent.rightLowerArm,
          order: "YZX",
          // rotationMin: new Vector3(0, (0.1 / 180) * Math.PI, 0),
          // rotationMax: new Vector3(0, Math.PI, 0),
          rotationMin: new Vector3(0, -Math.PI, -Math.PI),
          rotationMax: new Vector3(0, 0, 0),
          followTargetRotation: false
        },
        {
          boneName: BoneType.RightUpperArm,
          boneAsAvatarProp: AvatarComponent.rightUpperArm,
          order: "ZXY",
          rotationMin: new Vector3(-Math.PI / 2, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI / 2, Math.PI, Math.PI),
          followTargetRotation: false
        }
        // {
        //   boneName: BoneType.RightShoulder,
        //   boneAsAvatarProp: AvatarComponent.rightShoulder,
        //   order: "ZXY",
        //   rotationMin: new Vector3(0, -(45 / 180) * Math.PI, 0),
        //   rotationMax: new Vector3(0, (45 / 180) * Math.PI, (45 / 180) * Math.PI),
        //   followTargetRotation: false
        // }
      ],
      effectorBoneName: BoneType.RightHand,
      effectorBoneAsAvatarProp: AvatarComponent.rightHand,
      effectorFollowTargetRotation: true
    },
    // Left Leg
    {
      jointConfigs: [
        {
          boneName: BoneType.LeftLowerLeg,
          boneAsAvatarProp: AvatarComponent.leftLowerLeg,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, 0, 0),
          rotationMax: new Vector3(0, 0, 0),
          followTargetRotation: false
        },
        {
          boneName: BoneType.LeftUpperLeg,
          boneAsAvatarProp: AvatarComponent.leftUpperLeg,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI),
          followTargetRotation: false
        },
        {
          boneName: BoneType.Hips,
          boneAsAvatarProp: AvatarComponent.hips,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI),
          followTargetRotation: false
        }
      ],
      effectorBoneName: BoneType.LeftFoot,
      effectorBoneAsAvatarProp: AvatarComponent.leftFoot,
      effectorFollowTargetRotation: false
    },
    // Right Leg
    {
      jointConfigs: [
        {
          boneName: BoneType.RightLowerLeg,
          boneAsAvatarProp: AvatarComponent.rightLowerLeg,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, 0, 0),
          rotationMax: new Vector3(0, 0, 0),
          followTargetRotation: false
        },
        {
          boneName: BoneType.RightUpperLeg,
          boneAsAvatarProp: AvatarComponent.rightUpperLeg,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI),
          followTargetRotation: false
        },
        {
          boneName: BoneType.Hips,
          boneAsAvatarProp: AvatarComponent.hips,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI),
          followTargetRotation: false
        }
      ],
      effectorBoneName: BoneType.RightFoot,
      effectorBoneAsAvatarProp: AvatarComponent.rightFoot,
      effectorFollowTargetRotation: false
    }
  ]
};
