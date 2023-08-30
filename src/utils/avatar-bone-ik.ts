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

  joint.updateMatrixWorld(true);
  joint.updateMatrix();
};

export const avatarBoneIk = (world: HubsWorld, avatarEid: number, poseInputs: InputTransform, clientId: string) => {
  const rootBone = world.eid2obj.get(AvatarComponent.root[avatarEid]);
  const rootInput = poseInputs.rig?.get(clientId);
  if (rootBone && rootInput) {
    rootBone.position.set(rootInput.pos.x, rootInput.pos.y, rootInput.pos.z);
    rootBone.rotation.set(rootInput.rot.y, rootInput.rot.x, rootInput.rot.z);
    rootBone.rotation._onChangeCallback();
    rootBone.updateMatrix();
  }

  const rootPos = new Vector3();
  rootBone?.getWorldPosition(rootPos);
  let joint: Object3D | undefined;
  let effector: Object3D | undefined;

  for (var i = 0; i < defaultIKConfig.iteration; i++) {
    defaultIKConfig.chainConfigs.forEach(chainConfig => {
      chainConfig.jointConfigs.forEach(jointConfig => {
        joint = world.eid2obj.get(jointConfig.boneAsAvatarProp[avatarEid]);
        effector = world.eid2obj.get(chainConfig.effectorBoneAsAvatarProp[avatarEid]); // get bone Object3D by chainConfig.effectorBoneName
        let rawInput;
        const input = new Vector3();
        if (joint && effector) {
          switch (chainConfig.effectorBoneName) {
            case BoneType.Head:
              rawInput = poseInputs.hmd?.get(clientId)?.pos;
              break;
            case BoneType.LeftHand:
              rawInput = poseInputs.leftController?.get(clientId)?.pos;
              if (rawInput?.x == 0 && rawInput?.y == 0 && rawInput?.z == 0) {
                rawInput = { x: 0.2, y: 0.9, z: 0.1 };
              }
              break;
            case BoneType.RightHand:
              rawInput = poseInputs.rightController?.get(clientId)?.pos;
              if (rawInput?.x == 0 && rawInput?.y == 0 && rawInput?.z == 0) {
                rawInput = { x: -0.2, y: 0.9, z: -0.1 };
              }
              break;
            case BoneType.LeftFoot:
              rawInput = { x: 0.05, y: 0, z: 0 };
              break;
            case BoneType.RightFoot:
              rawInput = { x: -0.05, y: 0, z: 0 };
              break;
            default:
              break;
          }
          if (rawInput) input.set(rawInput?.x, rawInput?.y, rawInput?.z).add(rootPos);
          alignBoneWithTarget(joint, effector, input);
        }
      });
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
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI)
        },
        {
          boneName: BoneType.Chest,
          boneAsAvatarProp: AvatarComponent.chest,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI)
        },
        {
          boneName: BoneType.Spine,
          boneAsAvatarProp: AvatarComponent.spine,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI)
        },
        {
          boneName: BoneType.Hips,
          boneAsAvatarProp: AvatarComponent.hips,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI)
        }
      ],
      effectorBoneName: BoneType.Head,
      effectorBoneAsAvatarProp: AvatarComponent.head
    },
    // Left Shoulder -> Hand
    {
      jointConfigs: [
        {
          boneName: BoneType.LeftLowerArm,
          boneAsAvatarProp: AvatarComponent.leftLowerArm,
          order: "YZX",
          rotationMin: new Vector3(0, -Math.PI, 0),
          rotationMax: new Vector3(0, -(0.1 / 180) * Math.PI, 0)
        },
        {
          boneName: BoneType.LeftUpperArm,
          boneAsAvatarProp: AvatarComponent.leftUpperArm,
          order: "ZXY",
          rotationMin: new Vector3(-Math.PI / 2, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI / 2, Math.PI, Math.PI)
        },
        {
          boneName: BoneType.LeftShoulder,
          boneAsAvatarProp: AvatarComponent.leftShoulder,
          order: "ZXY",
          rotationMin: new Vector3(0, -(45 / 180) * Math.PI, -(45 / 180) * Math.PI),
          rotationMax: new Vector3(0, (45 / 180) * Math.PI, 0)
        }
      ],
      effectorBoneName: BoneType.LeftHand,
      effectorBoneAsAvatarProp: AvatarComponent.leftHand
    },
    // Right Shoulder -> Hand
    {
      jointConfigs: [
        {
          boneName: BoneType.RightLowerArm,
          boneAsAvatarProp: AvatarComponent.rightLowerArm,
          order: "YZX",
          rotationMin: new Vector3(0, (0.1 / 180) * Math.PI, 0),
          rotationMax: new Vector3(0, Math.PI, 0)
        },
        {
          boneName: BoneType.RightUpperArm,
          boneAsAvatarProp: AvatarComponent.rightUpperArm,
          order: "ZXY",
          rotationMin: new Vector3(-Math.PI / 2, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI / 2, Math.PI, Math.PI)
        },
        {
          boneName: BoneType.RightShoulder,
          boneAsAvatarProp: AvatarComponent.rightShoulder,
          order: "ZXY",
          rotationMin: new Vector3(0, -(45 / 180) * Math.PI, 0),
          rotationMax: new Vector3(0, (45 / 180) * Math.PI, (45 / 180) * Math.PI)
        }
      ],
      effectorBoneName: BoneType.RightHand,
      effectorBoneAsAvatarProp: AvatarComponent.rightHand
    },
    // Left Leg
    {
      jointConfigs: [
        {
          boneName: BoneType.LeftLowerLeg,
          boneAsAvatarProp: AvatarComponent.leftLowerLeg,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, 0, 0),
          rotationMax: new Vector3(0, 0, 0)
        },
        {
          boneName: BoneType.LeftUpperLeg,
          boneAsAvatarProp: AvatarComponent.leftUpperLeg,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI)
        },
        {
          boneName: BoneType.Hips,
          boneAsAvatarProp: AvatarComponent.hips,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI)
        }
      ],
      effectorBoneName: BoneType.LeftFoot,
      effectorBoneAsAvatarProp: AvatarComponent.leftFoot
    },
    // Right Leg
    {
      jointConfigs: [
        {
          boneName: BoneType.RightLowerLeg,
          boneAsAvatarProp: AvatarComponent.rightLowerLeg,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, 0, 0),
          rotationMax: new Vector3(0, 0, 0)
        },
        {
          boneName: BoneType.RightUpperLeg,
          boneAsAvatarProp: AvatarComponent.rightUpperLeg,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI)
        },
        {
          boneName: BoneType.Hips,
          boneAsAvatarProp: AvatarComponent.hips,
          order: "XYZ",
          rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
          rotationMax: new Vector3(Math.PI, Math.PI, Math.PI)
        }
      ],
      effectorBoneName: BoneType.RightFoot,
      effectorBoneAsAvatarProp: AvatarComponent.rightFoot
    }
  ]
};
