import { connectSfu, createSfuAdapter } from "../utils/sfu-adapter-utils";
import { SFU_CONNECTION_TYPE } from "../sfu-types";

export class PublicSpeakingSystem {
  static async initPublicSpeaker() {
    APP.publicSpeakingSfu = createSfuAdapter({ sfuId: APP.sfu._sfuId, connectionType: SFU_CONNECTION_TYPE.SEND });
    await connectSfu(APP.publicSpeakingSfu, {
      sfuId: APP.sfu._sfuId,
      clientId: "public-speaker",
      channelId: "public_speaking",
      scene: null,
      serverUrl: `wss://${APP.sfu._serverParams?.host || "localhost"}:4443`,
      serverParams: APP.sfu._serverParams || { host: "localhost", port: 443, turn: null },
      signalingUrl: APP.sfu._signalingUrl || "",
      accessToken: APP.sfu._accessToken || "",
      forceTcp: APP.sfu._forceTcp || false,
      forceTurn: APP.sfu._forceTurn || false,
      iceTransportPolicy: APP.sfu._iceTransportPolicy || false,
      debug: false
    });

    PublicSpeakingSystem.speakerTrySetLocalMediaStream();
  }

  static speakerTrySetLocalMediaStream() {
    if (!APP.publicSpeakingSfu._sendTransport) {
      window.setTimeout(
        PublicSpeakingSystem.speakerTrySetLocalMediaStream,
        1000
      ); /* this checks the flag every 100 milliseconds*/
    } else {
      APP.publicSpeakingSfu.setLocalMediaStream(APP.sfu._localMediaStream);
    }
  }

  static async initPublicSpeakingMirroring(channelId) {
    APP.mirrorSpeakingSfu = createSfuAdapter({ sfuId: APP.sfu._sfuId, connectionType: SFU_CONNECTION_TYPE.RECV });
    await connectSfu(APP.mirrorSpeakingSfu, {
      sfuId: APP.sfu._sfuId,
      clientId: APP.sfu._clientId,
      channelId: "public_speaking",
      scene: null,
      serverUrl: `wss://${APP.sfu._serverParams?.host || "localhost"}:4443`,
      serverParams: APP.sfu._serverParams || { host: "localhost", port: 443, turn: null },
      signalingUrl: APP.sfu._signalingUrl || "",
      accessToken: APP.sfu._accessToken || "",
      forceTcp: APP.sfu._forceTcp || false,
      forceTurn: APP.sfu._forceTurn || false,
      iceTransportPolicy: APP.sfu._iceTransportPolicy || false,
      debug: false
    });
    APP.publicSpeakingSfu = createSfuAdapter({ sfuId: APP.sfu._sfuId, connectionType: SFU_CONNECTION_TYPE.SEND });
    await connectSfu(APP.publicSpeakingSfu, {
      sfuId: APP.sfu._sfuId,
      clientId: "public-speaker",
      channelId: channelId,
      scene: null,
      serverUrl: `wss://${APP.sfu._serverParams.host || "localhost"}:4443`,
      serverParams: APP.sfu._serverParams || { host: "localhost", port: 3306, turn: null },
      signalingUrl: APP.sfu._signalingUrl || "",
      accessToken: APP.sfu._accessToken || "",
      forceTcp: APP.sfu._forceTcp || false,
      forceTurn: APP.sfu._forceTurn || false,
      iceTransportPolicy: APP.sfu._iceTransportPolicy || false,
      debug: false
    });
    APP.mirrorSpeakingSfu.on("stream_updated", this.mirrorPublicSpeaking, this);
  }

  static mirrorPublicSpeaking(clientId, kind) {
    if (clientId !== "public-speaker" || kind !== "audio") return;
    APP.mirrorSpeakingSfu.getMediaStream("public-speaker", "audio").then(stream => {
      APP.publicSpeakingSfu.setLocalMediaStream(stream);
    });
  }

  static mirrorDataChannelMessageFromSpeaker() {
    if (APP.publicSpeakingSfu && APP.mirrorSpeakingSfu) {
      APP.publicSpeakingSfu.setLocalDataChannelMessage(APP.mirrorSpeakingSfu.getDataChannelMessage());
    }
  }
}
