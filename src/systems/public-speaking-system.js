import { derivePublicSpeakingConfig } from "../sfu-adapters/sfu-config";
import { SFU_CONNECTION_TYPE } from "../sfu-types";
import { SfuSession } from "../sfu-adapters/sfu-session";

export class PublicSpeakingSystem {
  static clientIds = [];

  constructor() {
    function tryTogglePublicSpeaker() {
      if (APP.sfu) {
        APP.sfu.on("toggle-public-speaker", ({ message }) => {
          const clientId = message.split("|")[0];
          const isOn = message.split("|")[1] === "1";
          if (isOn) {
            if (clientId === APP.sfu.clientId) PublicSpeakingSystem.initPublicSpeaker();
            APP.sfu.publicSpeakerClientIds.push(clientId);
          } else {
            if (clientId === APP.sfu.clientId) PublicSpeakingSystem.closePublicSpeaker();
            const index = APP.sfu.publicSpeakerClientIds.indexOf(clientId);
            if (index > -1) APP.sfu.publicSpeakerClientIds.splice(index, 1);
          }
        });
      } else {
        window.setTimeout(tryTogglePublicSpeaker, 1000);
      }
    }

    tryTogglePublicSpeaker();
  }

  static toggleRemotePublicSpeaker(clientId, isOn) {
    APP.sfu.broadcast("#togglePublicSpeaker", clientId + "|" + (isOn ? "1" : "0"));
    if (isOn) {
      APP.sfu.publicSpeakerClientIds.push(clientId);
    } else {
      const index = APP.sfu.publicSpeakerClientIds.indexOf(clientId);
      if (index > -1) APP.sfu.publicSpeakerClientIds.splice(index, 1);
    }
  }

  static async initPublicSpeaker() {
    if (APP.publicSpeakingSfu) {
      console.log("initPublicSpeaker: already broadcasting, ignoring duplicate start request");
      return;
    }
    console.log("initPublicSpeaker");
    APP.publicSpeakingSfu = new SfuSession(SFU_CONNECTION_TYPE.SEND);
    APP.publicSpeakingSfu.hubChannel = APP.hubChannel;
    APP.publicSpeakingSfu.connect(
      derivePublicSpeakingConfig(APP.sfu.config, "public_speaking", "PS-" + APP.sfu.clientId)
    );
    APP.sfu.emit("public-speaking-sfu-initialized");

    PublicSpeakingSystem.speakerTrySetLocalMediaStream();
  }

  static closePublicSpeaker() {
    console.log("closePublicSpeaker");
    APP.publicSpeakingSfu.broadcast("#laserPointer", [0, 0, 0].join("|"));
    APP.publicSpeakingSfu.disconnect();
    APP.sfu.emit("public-speaking-sfu-closed");
    APP.publicSpeakingSfu = null;
  }

  static speakerTrySetLocalMediaStream() {
    if (!APP.publicSpeakingSfu.isConnected) {
      window.setTimeout(PublicSpeakingSystem.speakerTrySetLocalMediaStream, 1000);
    } else {
      APP.publicSpeakingSfu.setLocalMediaStream(APP.sfu.localMediaStream);
    }
  }

  static async initPublicSpeakingMirroring() {
    if (APP.publicSpeakersMirrorSfu) {
      console.log("initPublicSpeakingMirroring: already mirroring, ignoring duplicate start request");
      return;
    }
    console.log("initPublicSpeakingMirroring");
    APP.publicSpeakersMirrorSfu = new SfuSession(SFU_CONNECTION_TYPE.RECV);
    APP.publicSpeakersMirrorSfu.hubChannel = APP.hubChannel;
    APP.publicSpeakersMirrorSfu.connect(
      derivePublicSpeakingConfig(APP.sfu.config, "public_speaking", APP.sfu.clientId)
    );

    APP.publicSpeakersMirrorSfu.on("stream_updated", this.mirrorPublicSpeaking, this);
  }

  static async mirrorPublicSpeaking(clientId, kind) {
    if (!clientId.includes("PS-") || kind !== "audio") return;
    if (!APP.publicSpeakerAgentSfus) APP.publicSpeakerAgentSfus = {};
    if (!APP.publicSpeakerAgentSfus[clientId]) {
      await this.initPublicSpeakerAgent(clientId);
    }
    APP.publicSpeakersMirrorSfu.getMediaStream(clientId, "audio").then(stream => {
      APP.publicSpeakerAgentSfus[clientId].setLocalMediaStream(stream);
    });
  }

  static closePublicSpeakingMirroring() {
    if (APP.publicSpeakersMirrorSfu) {
      APP.publicSpeakersMirrorSfu.disconnect();
      APP.publicSpeakersMirrorSfu = null;
    }
    if (!APP.publicSpeakerAgentSfus) return;
    this.clientIds.forEach(clientId => {
      if (APP.publicSpeakerAgentSfus[clientId]) {
        APP.publicSpeakerAgentSfus[clientId].disconnect();
      }
    });
    APP.publicSpeakerAgentSfus = null;
    this.clientIds = [];
  }

  static mirrorDataChannelMessageFromSpeaker() {
    if (!APP.publicSpeakersMirrorSfu) return;
    this.clientIds.forEach(clientId => {
      if (APP.publicSpeakerAgentSfus[clientId]) {
        const relayed = APP.publicSpeakersMirrorSfu.bus.dequeueRelay();
        if (relayed) {
          APP.publicSpeakerAgentSfus[clientId].broadcastUint8(relayed.channelLabel, new Uint8Array(relayed.message));
        }
      }
    });
  }

  static async initPublicSpeakerAgent(clientId) {
    if (!clientId.includes("PS-")) return;
    if (APP.publicSpeakerAgentSfus?.[clientId]) {
      console.log("initPublicSpeakerAgent: agent already exists for", clientId, ", ignoring duplicate start request");
      return;
    }
    console.log("initPublicSpeakerAgent");
    this.clientIds.push(clientId);
    APP.publicSpeakerAgentSfus[clientId] = new SfuSession(SFU_CONNECTION_TYPE.SEND);
    APP.publicSpeakerAgentSfus[clientId].hubChannel = APP.hubChannel;
    const sfuToken = await APP.hubChannel.getSfuTokenOrFetch();
    APP.publicSpeakerAgentSfus[clientId].connect(
      derivePublicSpeakingConfig(APP.sfu.config, APP.sfu.roomId, clientId, sfuToken)
    );
  }
}
