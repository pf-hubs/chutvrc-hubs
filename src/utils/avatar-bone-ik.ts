import { Object3D, Quaternion, Vector3 } from "three";
import { BoneType } from "../constants";
import { HubsWorld } from "../app";
import { AvatarComponent } from "../bit-components";
import { InputTransform } from "../bit-systems/avatar-bones-system";

// Ref: https://scrapbox.io/ke456memo/%2327_pixiv%2Fthree-vrm%E3%81%A7VRM%E3%81%AB%E5%AF%BE%E5%BF%9C%E3%81%97%E3%81%9FIK%E3%82%92%E5%AE%9F%E8%A3%85%E3%81%99%E3%82%8B
const alignBoneWithTarget = (joint: Object3D, effector: Object3D, target: Vector3) => {
  let bonePosition = new Vector3();
  let boneQuaternionInverse = new Quaternion();
  let boneScale = new Vector3();
  let effectorPosition = new Vector3();
  let bone2EffectorVector = new Vector3();
  let bone2GoalVector = new Vector3();
  let axis = new Vector3();
  let quarternion = new Quaternion();

  joint.matrixWorld.decompose(bonePosition, boneQuaternionInverse, boneScale);
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

const alignBoneVerticalOrientation = (joint: Object3D, orientation: number) => {
  joint.rotation.y = orientation;
  joint.rotation._onChangeCallback();
  joint.updateMatrix();
};

export const avatarBoneIk = (
  world: HubsWorld,
  avatarEid: number,
  poseInputs: InputTransform,
  clientId: string,
  elapsed?: number
) => {
  const rootBone = world.eid2obj.get(AvatarComponent.root[avatarEid]);
  const rootInput = poseInputs.rig?.get(clientId);
  if (!rootBone || !rootInput) return;

  rootBone.position.set(rootInput.pos.x, rootInput.pos.y, rootInput.pos.z);

  rootBone.rotation.set(
    rootInput.rot.y,
    rootInput.rot.x + (poseInputs.hmd?.get(clientId)?.rot.x || 0),
    rootInput.rot.z
  );
  rootBone.rotation._onChangeCallback();
  rootBone.updateMatrix();

  const rootPos = new Vector3();
  const rootRot = new Quaternion();
  rootBone?.getWorldPosition(rootPos);
  rootBone?.getWorldQuaternion(rootRot);

  let joint: Object3D | undefined;
  let effector: Object3D | undefined;

  for (var i = 0; i < defaultIKConfig.iteration; i++) {
    defaultIKConfig.chainConfigs.forEach(chainConfig => {
      effector = world.eid2obj.get(chainConfig.effectorBoneAsAvatarProp[avatarEid]);

      chainConfig.jointConfigs.forEach(jointConfig => {
        joint = world.eid2obj.get(jointConfig.boneAsAvatarProp[avatarEid]);
        let rawPos;
        const inputPos = new Vector3();
        let followHeadVerticalRotation = true;
        if (joint && effector) {
          switch (chainConfig.effectorBoneName) {
            case BoneType.Head:
              rawPos = poseInputs.hmd?.get(clientId)?.pos;
              followHeadVerticalRotation = false;
              break;
            case BoneType.LeftHand:
              rawPos = poseInputs.leftController?.get(clientId)?.pos;
              if (rawPos?.x == 0 && rawPos?.y == 0 && rawPos?.z == 0) {
                rawPos = { x: 0.5, y: 0.9, z: 0.1 };
                // followHeadVerticalRotation = false; // if VR controller exists
              }
              break;
            case BoneType.RightHand:
              rawPos = poseInputs.rightController?.get(clientId)?.pos;
              if (rawPos?.x == 0 && rawPos?.y == 0 && rawPos?.z == 0) {
                rawPos = { x: -0.5, y: 0.9, z: 0.1 };
                // followHeadVerticalRotation = false; // if VR controller exists
              }
              break;
            case BoneType.LeftFoot:
              rawPos = { x: 0.05, y: 0, z: 0 };
              // followHeadVerticalRotation = false; // if VR tracker exists
              break;
            case BoneType.RightFoot:
              rawPos = { x: -0.05, y: 0, z: 0 };
              // followHeadVerticalRotation = false; // if VR tracker exists
              break;
            default:
              break;
          }
          if (rawPos) {
            inputPos.set(rawPos.x, rawPos.y, rawPos.z);
            const headRot = poseInputs.hmd?.get(clientId)?.rot;
            alignBoneWithTarget(
              joint,
              effector,
              inputPos
                .applyAxisAngle(
                  rootBone.up,
                  rootInput.rot.x - Math.PI + (headRot && followHeadVerticalRotation ? headRot.x : 0)
                )
                .add(rootPos)
            );
          }
        }
      });

      let targetRot = { x: 0, y: 0, z: 0 };
      switch (chainConfig.effectorBoneName) {
        case BoneType.Head:
          targetRot = poseInputs.hmd?.get(clientId)?.rot || { x: 0, y: 0, z: 0 };
          break;
        case BoneType.LeftHand:
          targetRot = poseInputs.leftController?.get(clientId)?.rot || { x: 0, y: 0, z: 0 };
          break;
        case BoneType.RightHand:
          targetRot = poseInputs.rightController?.get(clientId)?.rot || { x: 0, y: 0, z: 0 };
          break;
        default:
          break;
      }

      if (effector && targetRot) {
        effector.rotation.set(
          targetRot.y,
          chainConfig.effectorBoneName === BoneType.Head ? 0 : targetRot.x,
          targetRot.z
        );
        effector.rotation._onChangeCallback();
        effector.updateMatrix();
      }
    });
  }
};

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