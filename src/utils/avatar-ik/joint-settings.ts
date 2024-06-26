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
      // rotationMin: new Vector3(-2, 0, -Math.PI / 2),
      //     rotationMax: new Vector3(2, 0, Math.PI)
      rotationMin: new Vector3(-Math.PI / 2, -Math.PI / 2, -Math.PI / 2),
      rotationMax: new Vector3(Math.PI / 2, Math.PI / 2, Math.PI / 2)
    },
    elbow: {
      // TODO: try remove all constraints
      rotationOrder: "XZY",
      rotationMin: new Vector3(0, -1000, 0),
      rotationMax: new Vector3(Math.PI, 1000, Math.PI)
    }
  },
  rightArm: {
    base: {
      rotationOrder: "ZXY",
      //     rotationMin: new Vector3(-Math.PI / 2, 0, -Math.PI),
      //     rotationMax: new Vector3(Math.PI / 2, 0, Math.PI / 2)
      rotationMin: new Vector3(-Math.PI / 2, -Math.PI / 2, -Math.PI / 2),
      rotationMax: new Vector3(Math.PI / 2, Math.PI / 2, Math.PI / 2)
    },
    elbow: {
      // TODO: try remove all constraints
      rotationOrder: "XZY",
      rotationMin: new Vector3(0, -1000, -Math.PI),
      rotationMax: new Vector3(Math.PI, 1000, 0)
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
