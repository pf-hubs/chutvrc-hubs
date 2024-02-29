import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from "three";

const VECTOR_UP = new Vector3(0, 1, 0);

export class CCDIKSolver {
  private bone: Object3D;
  private effector: Object3D;
  private rotationMin: Vector3;
  private rotationMax: Vector3;
  private isYRotFixed: boolean;
  private bonePosition: Vector3;
  private boneQuaternionInverse: Quaternion;
  private effectorPosition: Vector3;
  private bone2EffectorVector: Vector3;
  private bone2GoalVector: Vector3;
  private axis: Vector3;
  private quarternionDiff: Quaternion;
  private rotationDiff: Euler;
  private deltaAngle: number;

  constructor(bone: Object3D, effector: Object3D, rotationMin: Vector3, rotationMax: Vector3, isYRotFixed = false) {
    this.bone = bone;
    this.effector = effector;
    this.rotationMin = rotationMin;
    this.rotationMax = rotationMax;
    this.isYRotFixed = isYRotFixed;

    this.bonePosition = new Vector3();
    this.boneQuaternionInverse = new Quaternion();
    this.effectorPosition = new Vector3();
    this.bone2EffectorVector = new Vector3();
    this.bone2GoalVector = new Vector3();
    this.axis = new Vector3();
    this.quarternionDiff = new Quaternion();
    this.rotationDiff = new Euler();
  }

  setYRotFixedFlag(isYRotFixed: boolean) {
    this.isYRotFixed = isYRotFixed;
  }

  // Ref: https://scrapbox.io/ke456memo/%2327_pixiv%2Fthree-vrm%E3%81%A7VRM%E3%81%AB%E5%AF%BE%E5%BF%9C%E3%81%97%E3%81%9FIK%E3%82%92%E5%AE%9F%E8%A3%85%E3%81%99%E3%82%8B
  alignBoneWithGoal = (goal: Vector3, goalRotY?: number) => {
    this.bone.getWorldPosition(this.bonePosition);
    this.bone.getWorldQuaternion(this.boneQuaternionInverse);
    this.boneQuaternionInverse.invert();

    this.effector.getWorldPosition(this.effectorPosition);
    this.bone2EffectorVector.subVectors(this.effectorPosition, this.bonePosition);
    this.bone2EffectorVector.applyQuaternion(this.boneQuaternionInverse);
    this.bone2EffectorVector.normalize();

    this.bone2GoalVector.subVectors(goal, this.bonePosition);
    this.bone2GoalVector.applyQuaternion(this.boneQuaternionInverse);
    this.bone2GoalVector.normalize();

    this.deltaAngle = this.bone2GoalVector.dot(this.bone2EffectorVector);
    if (this.deltaAngle > 1.0) {
      this.deltaAngle = 1.0;
    } else if (this.deltaAngle < -1.0) {
      this.deltaAngle = -1.0;
    }
    this.deltaAngle = Math.acos(this.deltaAngle);

    this.axis.crossVectors(this.bone2EffectorVector, this.bone2GoalVector);
    this.axis.normalize();

    this.quarternionDiff.setFromAxisAngle(this.axis, this.deltaAngle);

    this.bone.quaternion.multiply(this.quarternionDiff);
    this.rotationDiff.setFromQuaternion(this.bone.quaternion);

    this.rotationDiff.x = Math.max(this.rotationMin.x, Math.min(this.rotationMax.x, this.rotationDiff.x));
    this.rotationDiff.z = Math.max(this.rotationMin.z, Math.min(this.rotationMax.z, this.rotationDiff.z));
    if (!this.isYRotFixed) {
      this.rotationDiff.y = Math.max(this.rotationMin.y, Math.min(this.rotationMax.y, this.rotationDiff.y));
    }
    this.bone.quaternion.setFromEuler(this.rotationDiff);

    if (this.isYRotFixed && goalRotY) {
      this.bone.quaternion.setFromAxisAngle(VECTOR_UP, goalRotY % (Math.PI * 2));
      this.effector.rotation.y = 0;
      this.effector.rotation._onChangeCallback();
    }
    this.bone.rotation._onChangeCallback();
    this.bone.updateMatrix();
    this.bone.updateMatrixWorld(true);
  };
}
