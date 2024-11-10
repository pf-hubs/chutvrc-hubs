import * as THREE from "three";
import { Raycaster, Vector2 } from "three";

export function createClickable3dButton(position, onClickFunc) {
  const camera = document.getElementById("viewing-camera").object3DMap.camera;

  const buttonGeometry = new THREE.BoxGeometry(0.4, 0.2, 0.05);
  const buttonMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const buttonMesh = new THREE.Mesh(buttonGeometry, buttonMaterial);
  APP.world.scene.add(buttonMesh);

  buttonMesh.position.set(position.x, position.y, position.z);
  buttonMesh.updateMatrixWorld(true);

  const raycaster = new Raycaster();
  const mouse = new Vector2();

  let isHovered = false;
  let isClicked = false;

  const ORIGINAL_COLOR = new THREE.Color(0x00ff00);
  const HOVER_COLOR = new THREE.Color(0x0000ff);
  const CLICK_COLOR = new THREE.Color(0xff0000);

  const updateButtonState = () => {
    if (isClicked) {
      buttonMesh.material.color.copy(CLICK_COLOR);
    } else if (isHovered) {
      buttonMesh.material.color.copy(HOVER_COLOR);
    } else {
      buttonMesh.material.color.copy(ORIGINAL_COLOR);
    }
  };

  // Raycaster for detecting hover and click events
  const handleMouseEvent = event => {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    raycaster.ray.origin.y -= 0.2; // Adjust this value based on observed offset

    const intersects = raycaster.intersectObject(buttonMesh, false);

    if (intersects.length > 0) {
      if (event.type === "mousemove") {
        if (!isHovered) {
          isHovered = true;
          updateButtonState();
        }
      } else if (event.type === "click") {
        isClicked = true;
        updateButtonState();
        onClickFunc();
        console.log("Button clicked!");
      }
    } else {
      if (isHovered) {
        isHovered = false;
        isClicked = false;
        updateButtonState();
      }
    }
  };

  window.addEventListener("mousemove", handleMouseEvent);
  window.addEventListener("click", handleMouseEvent);

  buttonMesh.visible = false;
  return buttonMesh;
}
