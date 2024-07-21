import { connectSfu, createSfuAdapter } from "../utils/sfu-adapter-utils";
import { SFU_CONNECTION_TYPE } from "../sfu-types";

export class PublicSpeakingSystem {
  static clientIds = [];

  constructor() {
    function tryTogglePublicSpeaker() {
      if (APP.sfu) {
        APP.sfu.on("toggle-public-speaker", ({ message }) => {
          if (message.split("|")[0] === APP.sfu._clientId) {
            if (message.split("|")[1] === "0") {
              PublicSpeakingSystem.closePublicSpeaker();
            } else {
              PublicSpeakingSystem.initPublicSpeaker();
            }
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
  }

  static async initPublicSpeaker() {
    console.log("initPublicSpeaker");
    APP.publicSpeakingSfu = createSfuAdapter({ sfuId: APP.sfu._sfuId, connectionType: SFU_CONNECTION_TYPE.SEND });
    await connectSfu(APP.publicSpeakingSfu, {
      sfuId: APP.sfu._sfuId,
      clientId: "PS-" + APP.sfu._clientId,
      channelId: "public_speaking",
      scene: null,
      serverUrl: `wss://${APP.sfu._serverParams?.host || "localhost"}:4443`,
      serverParams: APP.sfu._serverParams || { host: "localhost", port: 443, turn: null },
      signalingUrl: APP.sfu._signalingUrl || "",
      accessToken: process.env.SORA_PUBLIC_SPEAKING_CHANNEL_TOKEN,
      forceTcp: APP.sfu._forceTcp || false,
      forceTurn: APP.sfu._forceTurn || false,
      iceTransportPolicy: APP.sfu._iceTransportPolicy || false,
      debug: false
    });
    APP.sfu.emit("public-speaking-sfu-initialized");

    PublicSpeakingSystem.speakerTrySetLocalMediaStream();
  }

  static closePublicSpeaker() {
    console.log("closePublicSpeaker");
    APP.publicSpeakingSfu.disconnect();
    APP.sfu.emit("public-speaking-sfu-closed");
  }

  static speakerTrySetLocalMediaStream() {
    if (!APP.publicSpeakingSfu._sendTransport && !APP.publicSpeakingSfu._connector) {
      window.setTimeout(PublicSpeakingSystem.speakerTrySetLocalMediaStream, 1000);
    } else {
      APP.publicSpeakingSfu.setLocalMediaStream(APP.sfu._localMediaStream);
    }
  }

  static async initPublicSpeakingMirroring() {
    console.log("initPublicSpeakingMirroring");
    APP.publicSpeakersMirrorSfu = createSfuAdapter({ sfuId: APP.sfu._sfuId, connectionType: SFU_CONNECTION_TYPE.RECV });
    await connectSfu(APP.publicSpeakersMirrorSfu, {
      sfuId: APP.sfu._sfuId,
      clientId: APP.sfu._clientId,
      channelId: "public_speaking",
      scene: null,
      serverUrl: `wss://${APP.sfu._serverParams?.host || "localhost"}:4443`,
      serverParams: APP.sfu._serverParams || { host: "localhost", port: 443, turn: null },
      signalingUrl: APP.sfu._signalingUrl || "",
      accessToken: process.env.SORA_PUBLIC_SPEAKING_CHANNEL_TOKEN,
      forceTcp: APP.sfu._forceTcp || false,
      forceTurn: APP.sfu._forceTurn || false,
      iceTransportPolicy: APP.sfu._iceTransportPolicy || false,
      debug: false
    });

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
    if (APP.publicSpeakersMirrorSfu) APP.publicSpeakersMirrorSfu.disconnect();
    if (!APP.publicSpeakerAgentSfus) return;
    this.clientIds.forEach(clientId => {
      if (APP.publicSpeakerAgentSfus[clientId]) APP.publicSpeakerAgentSfus[clientId].disconnect();
    });
    this.clientIds = [];
  }

  static mirrorDataChannelMessageFromSpeaker() {
    if (!APP.publicSpeakersMirrorSfu) return;
    this.clientIds.forEach(clientId => {
      if (APP.publicSpeakerAgentSfus[clientId]) {
        APP.publicSpeakerAgentSfus[clientId].setLocalDataChannelMessage(
          APP.publicSpeakersMirrorSfu.getDataChannelMessage()
        );
      }
    });
  }

  static async initPublicSpeakerAgent(clientId) {
    if (!clientId.includes("PS-")) return;
    console.log("initPublicSpeakerAgent");
    this.clientIds.push(clientId);
    APP.publicSpeakerAgentSfus[clientId] = createSfuAdapter({
      sfuId: APP.sfu._sfuId,
      connectionType: SFU_CONNECTION_TYPE.SEND
    });
    await connectSfu(APP.publicSpeakerAgentSfus[clientId], {
      sfuId: APP.sfu._sfuId,
      clientId: clientId,
      channelId: APP.sfu._roomId,
      scene: null,
      serverUrl: `wss://${APP.sfu._serverParams?.host || "localhost"}:4443`,
      serverParams: APP.sfu._serverParams || { host: "localhost", port: 3306, turn: null },
      signalingUrl: APP.sfu._signalingUrl || "",
      accessToken: APP.sfu._accessToken || "",
      forceTcp: APP.sfu._forceTcp || false,
      forceTurn: APP.sfu._forceTurn || false,
      iceTransportPolicy: APP.sfu._iceTransportPolicy || false,
      debug: false
    });
  }
}
