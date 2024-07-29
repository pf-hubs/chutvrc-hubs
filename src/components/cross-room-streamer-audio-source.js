import { SourceType } from "./audio-params";
const SHOULD_CREATE_SILENT_AUDIO_ELS = /chrome/i.test(navigator.userAgent);

function createSilentAudioEl(stream) {
  const audioEl = new Audio();
  audioEl.setAttribute("autoplay", "autoplay");
  audioEl.setAttribute("playsinline", "playsinline");
  audioEl.srcObject = stream;
  audioEl.volume = 0; // we don't actually want to hear audio from this element
  return audioEl;
}

// async function getOwnerId(el) {
//   const networkedEl = await NAF.utils.getNetworkedEntity(el).catch(e => {
//     console.error(INFO_INIT_FAILED, INFO_NO_NETWORKED_EL, e);
//   });
//   if (!networkedEl) {
//     return null;
//   }
//   return networkedEl.components.networked.data.owner;
// }

export class CrossRoomStreamerAudioSource {
  constructor(mediaStream, clientId = "", node = null) {
    this.stream = mediaStream;
    this.streamerClientId = clientId;

    // this.onPermissionsUpdated = this.onPermissionsUpdated.bind(this);

    this.audioSystem = AFRAME.scenes[0].systems["hubs-systems"].audioSystem;
    // We subscribe to audio stream notifications for this peer to update the audio source
    // This could happen in case there is an ICE failure that requires a transport recreation.
    // APP.sfu.on("stream_updated", this._onStreamUpdated, this);
    this.createAudio();
    if (node) this.attachAudio(node);

    let { disableLeftRightPanning, audioPanningQuality } = APP.store.state.preferences;
    this.onPreferenceChanged = () => {
      const newDisableLeftRightPanning = APP.store.state.preferences.disableLeftRightPanning;
      const newAudioPanningQuality = APP.store.state.preferences.audioPanningQuality;

      const shouldRecreateAudio = disableLeftRightPanning !== newDisableLeftRightPanning;
      const shouldUpdateAudioSettings = audioPanningQuality !== newAudioPanningQuality;

      disableLeftRightPanning = newDisableLeftRightPanning;
      audioPanningQuality = newAudioPanningQuality;

      // if (shouldRecreateAudio) {
      this.createAudio();
      // } else if (shouldUpdateAudioSettings) {
      //   // updateAudioSettings() is called in this.createAudio()
      //   // so no need to call it if shouldRecreateAudio is true.
      //   const audio = this.el.getObject3D(this.attrName);
      //   updateAudioSettings(this.el, audio);
      // }
    };
    APP.store.addEventListener("statechanged", this.onPreferenceChanged);
    // this.el.addEventListener("audio_type_changed", this.createAudio);
    // APP.hubChannel.addEventListener("permissions_updated", this.onPermissionsUpdated);
  }

  createAudio(stream = this.stream) {
    if (!stream) return;
    this.removeAudio();

    // APP.sourceType.set(this.el, SourceType.AVATAR_AUDIO_SOURCE);
    // const { audioType } = getCurrentAudioSettings(this.el);
    // let audio = this.el.getObject3D(this.attrName);
    // if (audioType === AudioType.PannerNode) {
    //   audio = new THREE.PositionalAudio(audioListener);
    // } else {
    //   audio = new THREE.Audio(audioListener);
    // }

    const audioListener = AFRAME.scenes[0].audioListener;
    const audio = new THREE.Audio(audioListener);
    // Default to being quiet so it fades in when volume is set by audio systems
    // audio.gain.gain.value = 0;

    this.audioSystem.addAudio({ sourceType: SourceType.AVATAR_AUDIO_SOURCE, node: audio });

    if (SHOULD_CREATE_SILENT_AUDIO_ELS) {
      createSilentAudioEl(stream); // TODO: Do the audio els need to get cleaned up?
    }

    this.destination = audio.context.createMediaStreamDestination();
    this.mediaStreamSource = audio.context.createMediaStreamSource(stream);
    const destinationSource = audio.context.createMediaStreamSource(this.destination.stream);
    this.mediaStreamSource.connect(this.destination);
    audio.setNodeSource(destinationSource);
    // this.el.setObject3D(this.attrName, audio);
    // this.el.emit("sound-source-set", { soundSource: destinationSource });

    // getOwnerId(this.el).then(async ownerId => {
    //   if (isRoomOwner(ownerId)) {
    //     APP.moderatorAudioSource.add(this.el);
    //   } else {
    //     APP.moderatorAudioSource.delete(this.el);
    //   }
    //   APP.audios.set(this.el, audio);
    //   updateAudioSettings(this.el, audio);
    // });

    this.audio = audio;
  }

  removeAudio() {
    if (this.audio) {
      this.audioSystem.removeAudio({ node: this.audio });
      // this.el.removeObject3D(this.attrName);
    }
  }

  // onPermissionsUpdated() {
  //   getOwnerId(this.el).then(async ownerId => {
  //     if (isRoomOwner(ownerId)) {
  //       APP.moderatorAudioSource.add(this.el);
  //     } else {
  //       APP.moderatorAudioSource.delete(this.el);
  //     }
  //     const audio = APP.audios.get(this.el);
  //     audio && updateAudioSettings(this.el, audio);
  //   });
  // }

  // async _onStreamUpdated(peerId, kind) {
  //   const audio = this.el.getObject3D(this.attrName);
  //   if (!audio) return;
  //   const stream = audio.source.mediaStream;
  //   if (!stream) return;

  //   getOwnerId(this.el).then(async ownerId => {
  //     if (ownerId === peerId && kind === "audio") {
  //       // The audio stream for this peer has been updated
  //       let newStream;
  //       switch (APP.usingSfu) {
  //         case SFU.DIALOG: {
  //           newStream = await APP.sfu.getMediaStream(peerId, "audio").catch(e => {
  //             console.error(INFO_INIT_FAILED, `Error getting media stream for ${peerId}`, e);
  //           });
  //           break;
  //         }
  //         case SFU.SORA:
  //           newStream = await APP.sfu.getMediaStream(peerId, "audio");
  //           break;
  //         default:
  //           break;
  //       }

  //       if (newStream) {
  //         this.mediaStreamSource.disconnect();
  //         this.mediaStreamSource = audio.context.createMediaStreamSource(newStream);
  //         this.mediaStreamSource.connect(this.destination);
  //       }
  //     }
  //   });
  // }

  remove() {
    // APP.sfu.off("stream_updated", this._onStreamUpdated);
    // APP.hubChannel.removeEventListener("permissions_updated", this.onPermissionsUpdated);

    window.APP.store.removeEventListener("statechanged", this.onPreferenceChanged);
    // this.el.removeEventListener("audio_type_changed", this.createAudio);

    // APP.audios.delete(this.el);
    // APP.sourceType.delete(this.el);
    // APP.supplementaryAttenuation.delete(this.el);

    this.removeAudio();
  }

  attachAudio(mesh) {
    this.node = mesh;
    this.node.add(this.audio);
  }
}
