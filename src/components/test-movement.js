import { SFU } from "../available-sfu";
import { SOUND_SPEAKER_TONE } from "../systems/sound-effects-system";

AFRAME.registerComponent("test-movement", {
  init: function () {
    this.intervalMs = 10000;
    this.previousTime = 0;
    this.isSending = false;
  },

  tick(time) {
    const elapsedTime = time - this.previousTime;
    if (!this.isSending && elapsedTime < this.intervalMs) {
      this.isSending = true;
      // TODO: send audio data directly to remote clients
      this.el.sceneEl.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_SPEAKER_TONE);
    }
    if (this.isSending) {
      const cnt = elapsedTime * 0.001;
      if (cnt / Math.PI < 1) {
        this.el.object3D.position.set(-1, 1 + Math.sin(cnt * 2), Math.cos(cnt * 2));
        APP.localTransformTimestamps.push([this.el.object3D.position, Date.now()]);
      }
      if (elapsedTime >= this.intervalMs) {
        this.isSending = false;
        this.previousTime = time;
      }
    }
  }
});

AFRAME.registerComponent("test-receive-movement", {
  init: function () {
    this.previousPositionZ = 0;
  },

  tick() {
    if (this.previousPositionZ != this.el.object3D.position.z && APP.usingSfu === SFU.DIALOG) {
      const clientId = this.el.parentElement.parentElement.getAttribute("client-id");
      if (clientId) {
        if (APP.transformTimestamps[clientId]) {
          APP.transformTimestamps[clientId].push([this.el.object3D.position, Date.now()]);
        } else {
          APP.transformTimestamps[clientId] = [];
        }
      }
    }
    this.previousPositionZ = this.el.object3D.position.z;
  }
});
