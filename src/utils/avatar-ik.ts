import { Object3D, Quaternion, Vector3 } from "three";
import { BoneType } from "../constants";
import { HubsWorld } from "../app";
import { AvatarComponent } from "../bit-components";
import { InputTransform } from "../bit-systems/avatar-bones-system";

type Vector3Type = { x: number; y: number; z: number };
type QuaternionType = { x: number; y: number; z: number };
type Transform = { pos: Vector3Type; rot: QuaternionType };

// Ref: https://scrapbox.io/ke456memo/%2327_pixiv%2Fthree-vrm%E3%81%A7VRM%E3%81%AB%E5%AF%BE%E5%BF%9C%E3%81%97%E3%81%9FIK%E3%82%92%E5%AE%9F%E8%A3%85%E3%81%99%E3%82%8B
const alignBoneWithTarget = (joint: Object3D, effector: Object3D, target: Vector3) => {
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
  joint.rotation._onChangeCallback();
  joint.updateMatrix();
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

    let headPos = new Vector3();
    APP.world.eid2obj.get(AvatarComponent.leftHand[avatarEid])?.getWorldPosition(headPos);
    let hipsPos = new Vector3();
    this.hipsBone?.getWorldPosition(hipsPos);
    this.hips2HeadDist = hipsPos && headPos ? headPos.y - hipsPos.y : 0;
  }

  updateAvatarBoneIk(avatarEid: number, poseInputs: InputTransform, clientId = "", deltaTime = 0) {
    if (!this.rootBone || !clientId) return;
    this.rootInput = poseInputs.rig?.get(clientId);
    this.updateRootHipsBone(
      poseInputs.hmd?.get(clientId),
      AvatarComponent.leftFoot[avatarEid] === 0 && AvatarComponent.rightFoot[avatarEid] === 0,
      deltaTime
    );

    this.rootBone.getWorldPosition(this.rootPos);
    this.rootBone.getWorldQuaternion(this.rootRot);

    for (let i = 0; i < defaultIKConfig.iteration; i++) {
      defaultIKConfig.chainConfigs.forEach(chainConfig => {
        this.updateEffectorAndJoint(avatarEid, poseInputs, clientId, chainConfig);
      });
    }
  }

  private updateRootHipsBone(hmdTransform: Transform | undefined, noLegs = false, deltaTime = 0) {
    if (!this.rootInput) return;
    this.rootBone?.position.set(this.rootInput.pos.x, this.rootInput.pos.y + (noLegs ? 1 : 0), this.rootInput.pos.z);
    this.rootBone?.rotation.set(
      this.rootInput.rot.y,
      this.rootInput.rot.x + (hmdTransform?.rot.x || 0) + (this.isFlippedY ? 0 : Math.PI),
      this.rootInput.rot.z
    );
    this.rootBone?.rotation._onChangeCallback();
    this.rootBone?.updateMatrix();

    if (this.hipsBone && hmdTransform) {
      const isHipsFarFromHead =
        Math.abs(hmdTransform.pos.x - this.hipsBone.position.x) > 0.2 ||
        Math.abs(hmdTransform.pos.z - this.hipsBone.position.z) > 0.2;
      let hipsBonePosX = this.hipsBone.position.x;
      let hipsBonePosZ = this.hipsBone.position.z;
      if (this.isWalking) {
        if (isHipsFarFromHead) {
          hipsBonePosX = this.hipsBone.position.x + (hmdTransform.pos.x - this.hipsBone.position.x) * deltaTime * 0.005;
          hipsBonePosZ = this.hipsBone.position.z + (hmdTransform.pos.z - this.hipsBone.position.z) * deltaTime * 0.005;
        } else {
          this.isWalking = false;
        }
      } else if (isHipsFarFromHead) {
        this.isWalking = true;
        console.log("Start walking");
      }
      this.hipsBone.position.set(hipsBonePosX, hmdTransform.pos.y - this.hips2HeadDist * 2, hipsBonePosZ);
    }
  }

  private updateEffectorAndJoint(avatarEid: number, poseInputs: InputTransform, clientId: string, chainConfig: any) {
    const effector = this.world.eid2obj.get(chainConfig.effectorBoneAsAvatarProp[avatarEid]);

    let targetRot = { x: 0, y: 0, z: 0 };

    chainConfig.jointConfigs.forEach((jointConfig: any) => {
      this.currentJoint = this.world.eid2obj.get(jointConfig.boneAsAvatarProp[avatarEid]);
      if (this.currentInputPosition && this.currentJoint && effector) {
        const followHeadVerticalRotation = this.getEffectorInputPosition(
          chainConfig.effectorBoneName,
          poseInputs,
          clientId
        );
        if (this.currentInputPosition && this.rootBone && this.rootInput) {
          alignBoneWithTarget(
            this.currentJoint,
            effector,
            this.currentInputPosition
              .applyAxisAngle(
                this.rootBone.up,
                this.rootInput.rot.x -
                  Math.PI +
                  (followHeadVerticalRotation ? poseInputs.hmd?.get(clientId)?.rot?.x || 0 : 0)
              )
              .add(this.rootPos)
          );
        }
      }
    });

    switch (chainConfig.effectorBoneName) {
      case BoneType.Head:
        targetRot = poseInputs.hmd?.get(clientId)?.rot || targetRot;
        break;
      case BoneType.LeftHand:
        targetRot = poseInputs.leftController?.get(clientId)?.rot || targetRot;
        break;
      case BoneType.RightHand:
        targetRot = poseInputs.rightController?.get(clientId)?.rot || targetRot;
        break;
      default:
        break;
    }

    if (effector) {
      // if (chainConfig.effectorBoneName === BoneType.Head) {
      //   effector.rotation.set(this.isFlippedY ? targetRot.y : -targetRot.y, 0, targetRot.z);
      // } else {
      //   effector.rotation.set(targetRot.x, this.isFlippedY ? targetRot.y : -targetRot.y, targetRot.z);
      // }
      effector.rotation.set(
        this.isFlippedY ? targetRot.y : -targetRot.y,
        chainConfig.effectorBoneName === BoneType.Head ? 0 : targetRot.x,
        targetRot.z
      );

      effector.rotation._onChangeCallback();
      effector.updateMatrix();
    }
  }

  private getEffectorInputPosition(effectorBoneName: any, poseInputs: InputTransform, clientId: string) {
    let rawPos;
    let followHeadVerticalRotation = true;
    switch (effectorBoneName) {
      case BoneType.Head:
        rawPos = poseInputs.hmd?.get(clientId)?.pos;
        if (this.isFlippedY && rawPos) {
          rawPos = { x: -rawPos.x, y: rawPos.y, z: -rawPos.z };
        }
        followHeadVerticalRotation = false;
        break;
      case BoneType.LeftHand:
        rawPos = poseInputs.leftController?.get(clientId)?.pos;
        if (rawPos) {
          if (rawPos.x == 0 && rawPos.y == 0 && rawPos.z == 0) {
            // if VR controller doesn't exist
            rawPos = { x: 0.5, y: 0.9, z: 0.1 };
          } else {
            // if VR controller exists
            followHeadVerticalRotation = false;
            if (this.isFlippedY) {
              rawPos = { x: -rawPos.x, y: rawPos.y, z: -rawPos.z };
            }
          }
        }
        break;
      case BoneType.RightHand:
        rawPos = poseInputs.rightController?.get(clientId)?.pos;
        if (rawPos) {
          if (rawPos.x == 0 && rawPos.y == 0 && rawPos.z == 0) {
            // if VR controller doesn't exist
            rawPos = { x: -0.5, y: 0.9, z: 0.1 };
          } else {
            // if VR controller exists
            followHeadVerticalRotation = false;
            if (this.isFlippedY) {
              rawPos = { x: -rawPos.x, y: rawPos.y, z: -rawPos.z };
            }
          }
        }
        break;
      case BoneType.LeftFoot:
        var hipsPos = this.hipsBone?.position;
        if (hipsPos) {
          rawPos = {
            x: ((this.isFlippedY ? -hipsPos.x : hipsPos.x) || 0) + (this.isFlippedY ? 0.05 : -0.05),
            y: 0,
            z: (this.isFlippedY ? -hipsPos.z : hipsPos.z) || 0
          };
        } else {
          rawPos = { x: this.isFlippedY ? 0.05 : -0.05, y: 0, z: 0 };
        }
        // TODO: walk / run animation when foot moves with hmd
        // TODO: IK when tracker for foot exists (in such case: followHeadVerticalRotation = false)
        break;
      case BoneType.RightFoot:
        var hipsPos = this.hipsBone?.position;
        if (hipsPos) {
          rawPos = {
            x: ((this.isFlippedY ? -hipsPos.x : hipsPos.x) || 0) + (this.isFlippedY ? -0.05 : 0.05),
            y: 0,
            z: (this.isFlippedY ? -hipsPos.z : hipsPos.z) || 0
          };
        } else {
          rawPos = { x: this.isFlippedY ? -0.05 : 0.05, y: 0, z: 0 };
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
}

// Usage
// const optimizer = new AvatarBoneIKOptimizer(world);
// optimizer.updateAvatarBoneIk(avatarEid, poseInputs, clientId);

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
          rotationMin: new Vector3(0, -Math.PI, 0),
          rotationMax: new Vector3(0, -(0.1 / 180) * Math.PI, 0),
          followTargetRotation: false
        },
        {
          boneName: BoneType.LeftUpperArm,
          boneAsAvatarProp: AvatarComponent.leftUpperArm,
          order: "ZXY",
          rotationMin: new Vector3(-Math.PI / 2, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI / 2, Math.PI, Math.PI),
          followTargetRotation: false
        },
        {
          boneName: BoneType.LeftShoulder,
          boneAsAvatarProp: AvatarComponent.leftShoulder,
          order: "ZXY",
          rotationMin: new Vector3(0, -(45 / 180) * Math.PI, -(45 / 180) * Math.PI),
          rotationMax: new Vector3(0, (45 / 180) * Math.PI, 0),
          followTargetRotation: false
        }
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
          rotationMin: new Vector3(0, (0.1 / 180) * Math.PI, 0),
          rotationMax: new Vector3(0, Math.PI, 0),
          followTargetRotation: false
        },
        {
          boneName: BoneType.RightUpperArm,
          boneAsAvatarProp: AvatarComponent.rightUpperArm,
          order: "ZXY",
          rotationMin: new Vector3(-Math.PI / 2, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI / 2, Math.PI, Math.PI),
          followTargetRotation: false
        },
        {
          boneName: BoneType.RightShoulder,
          boneAsAvatarProp: AvatarComponent.rightShoulder,
          order: "ZXY",
          rotationMin: new Vector3(0, -(45 / 180) * Math.PI, 0),
          rotationMax: new Vector3(0, (45 / 180) * Math.PI, (45 / 180) * Math.PI),
          followTargetRotation: false
        }
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
