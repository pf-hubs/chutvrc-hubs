import { Vector3 } from "three";

export const JointSettings = {
  head: {
    base: {
      rotationOrder: "XYZ",
      rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
      rotationMax: new Vector3(Math.PI, Math.PI, Math.PI)
    },
    elbow: {
      rotationOrder: "XYZ",
      rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
      rotationMax: new Vector3(Math.PI, Math.PI, Math.PI)
    }
  },
  leftArm: {
    base: {
      rotationOrder: "ZXY",
      rotationMin: new Vector3(-Math.PI / 2, -Math.PI / 2, -Math.PI / 2),
      rotationMax: new Vector3(Math.PI / 2, Math.PI / 2, Math.PI / 2)
    },
    elbow: {
      rotationOrder: "YZX",
      rotationMin: new Vector3(0, -Math.PI / 2, 0),
      rotationMax: new Vector3(0, Math.PI / 2, Math.PI)
    }
  },
  rightArm: {
    base: {
      rotationOrder: "ZXY",
      rotationMin: new Vector3(-Math.PI / 2, -Math.PI / 2, -Math.PI / 2),
      rotationMax: new Vector3(Math.PI / 2, Math.PI / 2, Math.PI / 2)
    },
    elbow: {
      rotationOrder: "YZX",
      rotationMin: new Vector3(0, -Math.PI / 2, -Math.PI),
      rotationMax: new Vector3(0, Math.PI / 2, 0)
    }
  },
  leftLeg: {
    base: {
      rotationOrder: "XYZ",
      rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
      rotationMax: new Vector3(Math.PI, Math.PI, Math.PI)
    },
    elbow: {
      rotationOrder: "XYZ",
      rotationMin: new Vector3(-Math.PI, 0, 0),
      rotationMax: new Vector3(0, 0, 0)
    }
  },
  rightLeg: {
    base: {
      rotationOrder: "XYZ",
      rotationMin: new Vector3(-Math.PI, -Math.PI, -Math.PI),
      rotationMax: new Vector3(Math.PI, Math.PI, Math.PI)
    },
    elbow: {
      rotationOrder: "XYZ",
      rotationMin: new Vector3(-Math.PI, 0, 0),
      rotationMax: new Vector3(0, 0, 0)
    }
  }
};
