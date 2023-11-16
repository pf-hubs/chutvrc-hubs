import { SFU } from "../available-sfu";
import URL_SPEAKER_TONE from "../assets/sfx/tone.mp3";

AFRAME.registerComponent("test-movement", {
  init: function () {
    this.intervalMs = 10000;
    this.previousTime = 0;
    this.isSending = false;
    this.audio = new Audio(URL_SPEAKER_TONE);
    this.audio.crossOrigin = "anonymous";
    this.audio.load();
  },

  tick(time) {
    if (!APP.isSenderInAudioAvatarSyncTest) {
      this.previousTime = time;
      return;
    }

    const elapsedTime = time - this.previousTime;
    if (!this.isSending && elapsedTime < this.intervalMs) {
      this.isSending = true;
      // Send audio stream from a local clip directly to remote clients
      this.audioStream = this.audio.captureStream();
      APP.sfu.setLocalMediaStream(this.audioStream);
      this.audio.play();
      APP.localAudioTimestamps.push(Date.now());
      // this.el.sceneEl.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_SPEAKER_TONE);
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
    this.clientId = "";
  },

  tick() {
    if (!APP.isReceiverInAudioAvatarSyncTest) return;

    if (!this.clientId) {
      this.clientId = this.el.parentElement.getAttribute("client-id");
      if (!this.clientId) this.clientId = this.el.parentElement.parentElement.getAttribute("client-id");
    }

    if (this.previousPositionZ != this.el.object3D.position.z && APP.usingSfu === SFU.DIALOG) {
      if (this.clientId) {
        if (APP.transformTimestamps[this.clientId]) {
          APP.transformTimestamps[this.clientId].push([this.el.object3D.position, Date.now()]);
        } else {
          APP.transformTimestamps[this.clientId] = [];
        }
      }
    }
    this.previousPositionZ = this.el.object3D.position.z;
  }
});
