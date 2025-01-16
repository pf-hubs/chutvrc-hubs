import { Vector3 } from "three";

export class TranscriptCanvas {
  textCanvas: HTMLCanvasElement;
  textCanvasMesh: THREE.Mesh;
  textLog: string[];

  constructor(initText: string) {
    this.init(initText);
  }

  init(defaultText: string) {
    this.textLog = [];
    this.textCanvas = document.createElement("canvas");
    const context = this.textCanvas.getContext("2d");
    if (!context) return;

    context.font = "24px sans-serif";
    this.textCanvas.width = 0;
    this.textCanvas.height = 30;

    const defaultTextWidth = context.measureText(defaultText).width;
    this.textCanvas.width = defaultTextWidth;
    this.textCanvas.height = 30;
    context.fillStyle = "rgba(255, 255, 255, 0.3)"; // Background color
    context.fillRect(0, 0, defaultTextWidth + 10, 30);

    // Draw text
    context.fillStyle = "white"; // Text color
    context.fillText(defaultText, 3, 20);
    const texture = new THREE.Texture(this.textCanvas);
    texture.needsUpdate = true;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide
    });
    material.transparent = true;
    this.textCanvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), material);
    this.textCanvasMesh.name = "transcript-canvas";
    APP.world.scene.add(this.textCanvasMesh);
    this.textCanvasMesh.scale.set(0.005, 0.005, 1);
    // this.textCanvasMesh.material.transparent = true;

    this.textCanvasMesh.geometry.scale(defaultTextWidth / 30, 1, 1);
    // this.textCanvasMesh.needsUpdate;
    this.textLog.push(defaultText);
  }

  writeOnCanvas(text: string) {
    if (!this.textCanvas || !this.textCanvasMesh) return;
    const context = this.textCanvas.getContext("2d");
    if (!context) return;

    const textWidth = context.measureText(text).width;
    this.textCanvas.width = textWidth;
    this.textCanvas.height = 30;
    context.fillStyle = "rgba(255, 255, 255, 0.3)"; // Background color
    context.fillRect(0, 0, textWidth + 20, 30);

    // Draw text
    context.fillStyle = "white"; // Text color
    context.fillText(text, 3, 20);
    const texture = new THREE.Texture(this.textCanvas);
    texture.needsUpdate = true;

    this.textCanvasMesh.material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide
    });
    this.textCanvasMesh.material.transparent = true;
    if (this.textLog.length > 0) {
      const lastTextWidth = context.measureText(this.textLog[this.textLog.length - 1]).width;
      this.textCanvasMesh.geometry.scale(30 / lastTextWidth, 1, 1);
    }
    this.textCanvasMesh.geometry.scale(textWidth / 30, 1, 1);
    // this.textCanvasMesh.needsUpdate;
    this.textLog.push(text);
  }

  updateTransform(x: number, y: number, z: number, lookAtPos: Vector3) {
    if (!this.textCanvasMesh) return;
    this.textCanvasMesh.position.set(x, y, z);
    this.textCanvasMesh.lookAt(lookAtPos);
    this.textCanvasMesh.rotateX(-1);
    this.textCanvasMesh.rotation._onChangeCallback();
  }
}
