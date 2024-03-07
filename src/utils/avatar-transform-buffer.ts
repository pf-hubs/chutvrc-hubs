import { AElement } from "aframe";
import { Euler, Object3D, Vector3 } from "three";
import { floatToUInt8, radToUInt8 } from "./uint8-parser";
import { encodeAvatarTransform } from "./avatar-utils";
import { InputTransform } from "../bit-systems/avatar-bones-system";

export enum AvatarPart {
  RIG = "RIG",
  HEAD = "HEAD",
  LEFT = "LEFT",
  RIGHT = "RIGHT"
}

export const avatarPartTypes = [AvatarPart.RIG, AvatarPart.HEAD, AvatarPart.LEFT, AvatarPart.RIGHT];

type Transform = {
  pos: Vector3;
  rot: Euler;
};

export type AvatarObjects = {
  [part in AvatarPart]: Object3D;
};

type AvatarTransforms = {
  [part in AvatarPart]: Transform;
};

type AvatarEncodedTransforms = {
  [part in AvatarPart]: Uint8Array;
};

const avatarTypeToStr = {
  [AvatarPart.RIG]: "rig",
  [AvatarPart.HEAD]: "hmd",
  [AvatarPart.LEFT]: "leftController",
  [AvatarPart.RIGHT]: "rightController"
};

export class AvatarTransformBuffer {
  _encodedClientId: Uint8Array;
  _avatarObj: AvatarObjects;
  _lastAvatarTransform: AvatarTransforms;
  _encodedAvatarTransform: AvatarEncodedTransforms;

  constructor(clientId: string, rig: AElement, head: AElement, left: AElement, right: AElement) {
    this._encodedClientId = new TextEncoder().encode(clientId);
    this._avatarObj = {
      [AvatarPart.RIG]: rig.object3D,
      [AvatarPart.HEAD]: head.object3D,
      [AvatarPart.LEFT]: left.object3D,
      [AvatarPart.RIGHT]: right.object3D
    };
    this._lastAvatarTransform = {
      [AvatarPart.RIG]: {
        pos: rig.object3D.position.clone(),
        rot: rig.object3D.rotation.clone()
      },
      [AvatarPart.HEAD]: {
        pos: head.object3D.position.clone(),
        rot: head.object3D.rotation.clone()
      },
      [AvatarPart.LEFT]: {
        pos: left.object3D.position.clone(),
        rot: left.object3D.rotation.clone()
      },
      [AvatarPart.RIGHT]: {
        pos: right.object3D.position.clone(),
        rot: right.object3D.rotation.clone()
      }
    };
    // this._avatarInputTransform = {
    //   [AvatarPart.RIG]: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    //   [AvatarPart.HEAD]: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    //   [AvatarPart.LEFT]: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    //   [AvatarPart.RIGHT]: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } }
    // };
    this._encodedAvatarTransform = {
      [AvatarPart.RIG]: new Uint8Array(45),
      [AvatarPart.HEAD]: new Uint8Array(45),
      [AvatarPart.LEFT]: new Uint8Array(45),
      [AvatarPart.RIGHT]: new Uint8Array(45)
    };
  }

  isUpdateAvatarTransformUpdated(part: AvatarPart) {
    return (
      this.isPositionUpdated(this._avatarObj[part].position, this._lastAvatarTransform[part].pos) ||
      this.isRotationUpdated(this._avatarObj[part].rotation, this._lastAvatarTransform[part].rot)
    );
  }

  updateAvatarTransform(part: AvatarPart) {
    this._lastAvatarTransform[part].pos.copy(this._avatarObj[part].position);
    this._lastAvatarTransform[part].rot.copy(this._avatarObj[part].rotation);
  }

  getAvatarTransform(part: AvatarPart) {
    return this._lastAvatarTransform[part];
  }

  getEncodedAvatarTransform(part: AvatarPart) {
    if (this._encodedAvatarTransform[part]) {
      this._encodedAvatarTransform[part].set(encodeAvatarTransform(this._avatarObj[part], this._encodedClientId));
    } else {
      this._encodedAvatarTransform[part] = new Uint8Array(
        encodeAvatarTransform(this._avatarObj[part], this._encodedClientId)
      );
    }
    return this._encodedAvatarTransform[part];
  }

  isPositionUpdated(p1: Vector3, p2: Vector3) {
    return p1.distanceTo(p2) > 0.01;
  }

  isRotationUpdated(r1: Euler, r2: Euler) {
    return Math.abs(r1.x - r2.x) > 0.01 || Math.abs(r1.y - r2.y) > 0.01 || Math.abs(r1.z - r2.z) > 0.01;
  }
}
