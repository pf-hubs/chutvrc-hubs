import { Position, Rotation, Transform } from "../types/transform";

export class TransformLowPassFilter {
  private bufferPos: Position;
  private bufferRot: Rotation;
  private alphaPos: number;
  private alphaRot: number;

  constructor(
    alphaPos: number,
    alphaRot: number,
    initPosX = 0,
    initPosY = 0,
    initPosZ = 0,
    initRotX = 0,
    initRotY = 0,
    initRotZ = 0
  ) {
    this.alphaPos = alphaPos;
    this.alphaRot = alphaRot;
    this.bufferPos = {
      x: initPosX,
      y: initPosY,
      z: initPosZ
    };
    this.bufferRot = {
      x: initRotX,
      y: initRotY,
      z: initRotZ
    };
  }

  private updatePosition(rawTransform: Transform) {
    if (rawTransform.pos.x !== 0) {
      this.bufferPos.x = rawTransform.pos.x * this.alphaPos + this.bufferPos.x * (1 - this.alphaPos);
    }
    if (rawTransform.pos.y !== 0) {
      this.bufferPos.y = rawTransform.pos.y * this.alphaPos + this.bufferPos.y * (1 - this.alphaPos);
    }
    if (rawTransform.pos.z !== 0) {
      this.bufferPos.z = rawTransform.pos.z * this.alphaPos + this.bufferPos.z * (1 - this.alphaPos);
    }
  }

  private updateRotation(rawTransform: Transform) {
    if (rawTransform.rot.x !== 0) {
      this.bufferRot.x = rawTransform.rot.x * this.alphaRot + this.bufferRot.x * (1 - this.alphaRot);
    }
    if (rawTransform.rot.y !== 0) {
      this.bufferRot.y = rawTransform.rot.y * this.alphaRot + this.bufferRot.y * (1 - this.alphaRot);
    }
    if (rawTransform.rot.z !== 0) {
      this.bufferRot.z = rawTransform.rot.z * this.alphaRot + this.bufferRot.z * (1 - this.alphaRot);
    }
  }

  getTransformWithFilteredPosition(rawTransform: Transform) {
    this.updatePosition(rawTransform);
    return { ...rawTransform, pos: this.bufferPos };
  }

  getTransformWithFilteredRotation(rawTransform: Transform) {
    this.updateRotation(rawTransform);
    return { ...rawTransform, rot: this.bufferRot };
  }

  getFilteredTransform(rawTransform: Transform) {
    this.updatePosition(rawTransform);
    this.updateRotation(rawTransform);
    return { ...rawTransform, pos: this.bufferPos, rot: this.bufferRot };
  }
}
