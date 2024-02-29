import * as THREE from "three";
export class AvatarAnimator {
  /*
  constructor() {}

  playWalkAnimation() {
    const model = gltf.scene;
    scene.add(model);

    // Create Skeleton Helper
    skeletonHelper = new THREE.SkeletonHelper(model);
    scene.add(skeletonHelper);

    // Identify bones
    const armBone = model.getObjectByName("ArmBoneName"); // Replace with actual bone name
    const legBone = model.getObjectByName("LegBoneName"); // Replace with actual bone name

    // Create Animation Mixer
    mixer = new THREE.AnimationMixer(model);

    // Keyframe Animation
    const clip = new THREE.AnimationClip("walk", -1, [
      // Replace with actual keyframe tracks for arm and leg bones
      new THREE.NumberKeyframeTrack("ArmBoneName.rotation", [0, 1], [0, Math.PI / 2]),
      new THREE.NumberKeyframeTrack("LegBoneName.rotation", [0, 1], [-Math.PI / 2, 0])
    ]);

    const action = mixer.clipAction(clip);
    action.play();

    // Animation loop
    const clock = new THREE.Clock();
    function animate() {
      requestAnimationFrame(animate);

      if (mixer) {
        mixer.update(clock.getDelta());
      }

      renderer.render(scene, camera);
    }
    animate();
  }

  // Function to create a simple walk animation
  createWalkAnimation(model) {
    const times = [0, 0.5, 1.0, 1.5, 2.0]; // Keyframe times

    // Feet rotation (example values, you'll need to adjust these)
    const leftFootValues = [0, -0.2, 0, 0.2, 0];
    const rightFootValues = [0, 0.2, 0, -0.2, 0];

    // Knee rotation (example values)
    const leftKneeValues = [0, 0.3, 0.6, 0.3, 0];
    const rightKneeValues = [0.6, 0.3, 0, 0.3, 0.6];

    // Thigh rotation (example values)
    const leftThighValues = [0, -0.3, -0.6, -0.3, 0];
    const rightThighValues = [-0.6, -0.3, 0, -0.3, -0.6];

    // Creating NumberKeyframeTracks for each bone
    const leftFootTrack = new THREE.NumberKeyframeTrack("leftFoot.rotation.x", times, leftFootValues);
    const rightFootTrack = new THREE.NumberKeyframeTrack("rightFoot.rotation.x", times, rightFootValues);
    const leftKneeTrack = new THREE.NumberKeyframeTrack("leftKnee.rotation.x", times, leftKneeValues);
    const rightKneeTrack = new THREE.NumberKeyframeTrack("rightKnee.rotation.x", times, rightKneeValues);
    const leftThighTrack = new THREE.NumberKeyframeTrack("leftThigh.rotation.x", times, leftThighValues);
    const rightThighTrack = new THREE.NumberKeyframeTrack("rightThigh.rotation.x", times, rightThighValues);

    // Creating an AnimationClip
    const walkClip = new THREE.AnimationClip("walk", -1, [
      leftFootTrack,
      rightFootTrack,
      leftKneeTrack,
      rightKneeTrack,
      leftThighTrack,
      rightThighTrack
    ]);

    return walkClip;
  }

  // Use the function to create the animation clip
  // let walkAnimationClip = createWalkAnimation(model);

  // Further, you would use an AnimationMixer to play this clip
  // let mixer = new THREE.AnimationMixer(model);
  // let action = mixer.clipAction(walkAnimationClip);
  // action.play();
  */
}
