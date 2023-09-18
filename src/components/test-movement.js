import { SFU } from "../available-sfu";
import { SOUND_SPEAKER_TONE } from "../systems/sound-effects-system";

AFRAME.registerComponent("test-movement", {
  init: function () {
    this.interval = 500;
    this.previousTime = 0;
  },

  tick(time) {
    const elapsedTime = time - this.previousTime;
    const cnt = elapsedTime * 0.001;
    if (cnt / Math.PI < 1) {
      this.el.object3D.position.set(-1, 1 + Math.sin(cnt * 2), Math.cos(cnt * 2));
      APP.localTransformTimestamps.push([this.el.object3D.position.z, Date.now()]);
    }
    // console.log(this.el.object3D.position);
    if (cnt / (Math.PI * 2) > 1) {
      this.el.sceneEl.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_SPEAKER_TONE);
      this.previousTime = time;
    }
  }
});

AFRAME.registerComponent("test-receive-movement", {
  init: function () {
    this.previousPositionZ = 0;
  },

  tick() {
    if (this.previousPositionZ != this.el.object3D.position.z && APP.usingSfu === SFU.DIALOG) {
      APP.transformTimestamps.push([this.el.object3D.position.z, Date.now()]);
    }
    this.previousPositionZ = this.el.object3D.position.z;
  }
});
