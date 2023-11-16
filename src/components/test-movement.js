// Components for audio avatar sync test

import { SFU } from "../available-sfu";
import URL_SPEAKER_TONE from "../assets/sfx/tone.mp3";

AFRAME.registerComponent("test-movement", {
  init: function () {
    this.intervalMs = 10000;
    this.previousTime = 0;
    this.isSending = false;
    this.reloadAudio();
    this.isAudioStreamReset = false;
  },

  tick(time) {
    if (!APP.isSenderInAASyncTest) {
      this.previousTime = time;
      if (this.isSending) this.isSending = false;
      return;
    }

    const elapsedTime = time - this.previousTime;
    if (!this.isSending && elapsedTime < this.intervalMs) {
      this.isSending = true;
      this.audioStream = this.audio.captureStream();
      APP.sfu.setLocalMediaStream(this.audioStream);
      this.audio.play();
      APP.localAudioTimestamps.push(Date.now());
      APP.localTransformTimestamps.push([]);
      // this.el.sceneEl.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_SPEAKER_TONE);
    }
    if (this.isSending) {
      const cnt = elapsedTime * 0.001;
      if (cnt / Math.PI < 0.5) {
        this.el.object3D.position.set(-1, 1 + Math.sin(cnt * 4), Math.cos(cnt * 4));
        APP.localTransformTimestamps[APP.localTransformTimestamps.length - 1].push([Math.cos(cnt * 4), Date.now()]);
      }
      if (!this.isAudioStreamReset && elapsedTime >= this.intervalMs / 2) {
        this.reloadAudio();
      }
      if (elapsedTime >= this.intervalMs) {
        this.isSending = false;
        this.previousTime = time;
        this.isAudioStreamReset = false;
      }
    }
  },

  reloadAudio() {
    this.audio = new Audio(URL_SPEAKER_TONE);
    this.audio.crossOrigin = "anonymous";
    this.audio.load();
    this.isAudioStreamReset = true;
  }
});

AFRAME.registerComponent("test-receive-movement", {
  init: function () {
    this.previousPositionZ = this.el.object3D.position.z;
    this.clientId = "";
    this.responseObject = null;
    this.lastTimestamp = {}; // { [clientId: string]: number }
  },

  tick() {
    if (!APP.isReceiverInAASyncTest || APP.usingSfu !== SFU.DIALOG) return;

    if (!this.clientId) {
      this.clientId = this.el.parentElement.getAttribute("client-id");
      if (!this.clientId) this.clientId = this.el.parentElement.parentElement.getAttribute("client-id");
    }

    if (!this.responseObject) {
      this.responseObject = document.getElementById("player-right-controller")?.object3D;
      this.responseObject?.position.set(0, 0, 0.5);
    }

    if (this.previousPositionZ != this.el.object3D.position.z) {
      if (this.clientId) {
        const transformArriveTime = Date.now();
        if (!APP.transformTimestamps[this.clientId]) {
          APP.transformTimestamps[this.clientId] = [];
        }
        if (!this.lastTimestamp[this.clientId] || transformArriveTime - this.lastTimestamp[this.clientId] > 1000) {
          APP.transformTimestamps[this.clientId].push([]);
        }
        APP.transformTimestamps[this.clientId][APP.transformTimestamps[this.clientId].length - 1].push([
          this.el.object3D.position.z,
          transformArriveTime
        ]);
        if (this.responseObject) {
          this.responseObject.position.set(0, 0, -this.responseObject.position.z);
        }
        this.lastTimestamp[this.clientId] = transformArriveTime;
      }
    }
    this.previousPositionZ = this.el.object3D.position.z;
  }
});

AFRAME.registerComponent("test-get-receiver-response", {
  init: function () {
    this.previousPositionZ = this.el.object3D.position.z;
    this.clientId = "";
  },

  tick() {
    if (!APP.isSenderInAASyncTest) return;

    if (!this.clientId) {
      this.clientId = this.el.parentElement.getAttribute("client-id");
      if (!this.clientId) this.clientId = this.el.parentElement.parentElement.getAttribute("client-id");
    }

    if (this.previousPositionZ != this.el.object3D.position.z && APP.usingSfu === SFU.DIALOG && this.clientId) {
      if (!APP.estimatedRecvAvatarTimestampsAtSenderClock[this.clientId]) {
        APP.estimatedRecvAvatarTimestampsAtSenderClock[this.clientId] = [];
      }
      if (APP.estimatedRecvAvatarTimestampsAtSenderClock[this.clientId].length < APP.localTransformTimestamps.length) {
        const sendTimestamp = APP.localTransformTimestamps[APP.localTransformTimestamps.length - 1][0][1];
        APP.estimatedRecvAvatarTimestampsAtSenderClock[this.clientId].push((sendTimestamp + Date.now()) / 2);
      }
    }
    this.previousPositionZ = this.el.object3D.position.z;
  }
});
