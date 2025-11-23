import * as THREE from "three";
import { Raycaster, Vector2 } from "three";

export class Clickable3DButton {
  constructor(camera, scene, defaultColor, activeColor, onClickFunc) {
    this.camera = camera;
    this.scene = scene;
    this.onClickFunc = onClickFunc;

    this.defaultColor = new THREE.Color(defaultColor);
    this.activeColor = new THREE.Color(activeColor);
    this.hoverColor = this.activeColor.clone().offsetHSL(0, -0.2, 0.2); // Slightly brighter for hover

    this.isActive = false; // Tracks if the button is active
    this.isHovered = false; // Tracks if the button is hovered

    this.initButton();
    this.initEventListeners();
  }

  initButton() {
    const buttonGeometry = new THREE.SphereGeometry(0.1, 16, 16);
    const buttonMaterial = new THREE.MeshBasicMaterial({ color: this.defaultColor });
    this.buttonMesh = new THREE.Mesh(buttonGeometry, buttonMaterial);
    this.scene.add(this.buttonMesh);
  }

  initEventListeners() {
    this.raycaster = new Raycaster();
    this.mouse = new Vector2();

    this.handleMouseEvent = this.handleMouseEvent.bind(this);
    window.addEventListener("mousemove", this.handleMouseEvent);
    window.addEventListener("click", this.handleMouseEvent);
  }

  handleMouseEvent(event) {
    this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    const intersects = this.raycaster.intersectObject(this.buttonMesh, false);

    if (intersects.length > 0) {
      if (event.type === "mousemove") {
        if (!this.isHovered) {
          this.isHovered = true;
          this.updateButtonColor();
        }
      } else if (event.type === "click") {
        this.isActive = true;
        this.updateButtonColor();
        this.onClickFunc();
      }
    } else {
      if (event.type === "mousemove" && this.isHovered) {
        this.isHovered = false;
        this.updateButtonColor();
      }
    }
  }

  updateButtonColor() {
    if (this.isActive) {
      this.buttonMesh.material.color.copy(this.activeColor);
    } else if (this.isHovered) {
      this.buttonMesh.material.color.copy(this.hoverColor);
    } else {
      this.buttonMesh.material.color.copy(this.defaultColor);
    }
  }

  setButtonActive() {
    this.isActive = true;
    this.updateButtonColor();
  }

  resetActiveState() {
    this.isActive = false;
    this.updateButtonColor();
  }

  setPosition(position) {
    this.buttonMesh.position.copy(position);
    this.buttonMesh.updateMatrix();
  }

  dispose() {
    this.scene.remove(this.buttonMesh);
    this.buttonMesh.geometry.dispose();
    this.buttonMesh.material.dispose();
    window.removeEventListener("mousemove", this.handleMouseEvent);
    window.removeEventListener("click", this.handleMouseEvent);
  }
}
