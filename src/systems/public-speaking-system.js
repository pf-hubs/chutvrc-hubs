import { connectSfu, createSfuAdapter } from "../utils/sfu-adapter-utils";
import { SFU_CONNECTION_TYPE } from "../sfu-types";

export class PublicSpeakingSystem {
  static clientIds = [];

  constructor() {
    function tryTogglePublicSpeaker() {
      if (APP.sfu) {
        APP.sfu.on("toggle-public-speaker", ({ message }) => {
          const clientId = message.split("|")[0];
          const isOn = message.split("|")[1] === "1";
          if (isOn) {
            if (clientId === APP.sfu._clientId) PublicSpeakingSystem.initPublicSpeaker();
            if (!APP.sfu._publicSpeakerClientIdsInRoom.includes(clientId))
              APP.sfu._publicSpeakerClientIdsInRoom.push(clientId);
          } else {
            if (clientId === APP.sfu._clientId) PublicSpeakingSystem.closePublicSpeaker();
            const index = APP.sfu._publicSpeakerClientIdsInRoom.indexOf(clientId);
            if (index > -1) APP.sfu._publicSpeakerClientIdsInRoom.splice(index, 1);
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
      APP.sfu._publicSpeakerClientIdsInRoom.push(clientId);
    } else {
      const index = APP.sfu._publicSpeakerClientIdsInRoom.indexOf(clientId);
      if (index > -1) APP.sfu._publicSpeakerClientIdsInRoom.splice(index, 1);
    }
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
    this.toggleRemotePublicSpeaker(APP.sfu._clientId, true);
  }

  static closePublicSpeaker() {
    console.log("closePublicSpeaker");

    APP.publicSpeakingSfu.broadcast("#laserPointer", [0, 0, 0].join("|"));
    APP.publicSpeakingSfu.disconnect();
    APP.sfu.emit("public-speaking-sfu-closed");
    APP.publicSpeakingSfu = null;

    this.toggleRemotePublicSpeaker(APP.sfu._clientId, false);
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

  static toggleRecordingAcrossRooms() {
    if (APP.publicSpeakingSfu) {
      APP.publicSpeakingSfu._isRecording = !APP.publicSpeakingSfu._isRecording;
      APP.sfu._isRecording = APP.publicSpeakingSfu._isRecording;
    }
  }
}
