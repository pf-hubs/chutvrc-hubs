import { connectSfu, createSfuAdapter } from "../utils/sfu-adapter-utils";
import { SFU_CONNECTION_TYPE } from "../sfu-types";

export class PublicSpeakingSystem {
  static initPublicSpeaker() {
    APP.publicSpeakingSfu = createSfuAdapter({ connectionType: SFU_CONNECTION_TYPE.SEND });
    connectSfu(APP.publicSpeakingSfu, {
      clientId: "public-speaker",
      channelId: "public-speaking",
      scene: null,
      serverUrl: APP.sfu._serverUrl || "",
      serverParams: APP.sfu._serverParams || { host: "localhost", port: 3306, turn: null },
      // signalingUrl: data.sora_signaling_url, TODO: retrieve sora_signaling_url
      // accessToken: data.sora_access_token, TODO: retrieve sora access token by channelId "public-speaking"
      forceTcp: APP.sfu._forceTcp || false,
      forceTurn: APP.sfu._forceTurn || false,
      iceTransportPolicy: APP.sfu._iceTransportPolicy || false,
      debug: false
    });
  }

  static initPublicSpeakingMirroring(channelId) {
    APP.publicSpeakingSfu = createSfuAdapter({ connectionType: SFU_CONNECTION_TYPE.RECV });
    connectSfu(APP.publicSpeakingSfu, {
      clientId: APP.sfu._clientId,
      channelId: "public-speaking",
      scene: null,
      serverUrl: APP.sfu._serverUrl || "",
      serverParams: APP.sfu._serverParams || { host: "localhost", port: 3306, turn: null },
      // signalingUrl: data.sora_signaling_url, TODO: retrieve sora_signaling_url
      // accessToken: data.sora_access_token, TODO: retrieve sora access token by channelId "public-speaking"
      forceTcp: APP.sfu._forceTcp || false,
      forceTurn: APP.sfu._forceTurn || false,
      iceTransportPolicy: APP.sfu._iceTransportPolicy || false,
      debug: false
    });
    APP.mirrorSpeakingSfu = createSfuAdapter({ connectionType: SFU_CONNECTION_TYPE.SEND });
    connectSfu(APP.mirrorSpeakingSfu, {
      clientId: "public-speaker",
      channelId: channelId,
      scene: null,
      serverUrl: APP.sfu._serverUrl || "",
      serverParams: APP.sfu._serverParams || { host: "localhost", port: 3306, turn: null },
      // signalingUrl: data.sora_signaling_url, TODO: retrieve sora_signaling_url
      // accessToken: data.sora_access_token, TODO: retrieve sora access token by channelId hubChannel.hubId
      forceTcp: APP.sfu._forceTcp || false,
      forceTurn: APP.sfu._forceTurn || false,
      iceTransportPolicy: APP.sfu._iceTransportPolicy || false,
      debug: false
    });
    APP.publicSpeakingSfu.on("stream_updated", this.mirrorPublicSpeaking, this);
  }

  static mirrorPublicSpeaking(clientId, kind) {
    if (clientId !== "public-speaker" || kind !== "audio") return;
    APP.publicSpeakingSfu.getMediaStream("public-speaker", "audio").then(stream => {
      APP.mirrorSpeakingSfu.setLocalMediaStream(stream);
    });
  }

  static mirrorDataChannelMessageFromSpeaker() {
    if (APP.publicSpeakingSfu && APP.mirrorSpeakingSfu) {
      APP.mirrorSpeakingSfu.setLocalDataChannelMessage(APP.publicSpeakingSfu.getDataChannelMessage());
    }
  }
}
