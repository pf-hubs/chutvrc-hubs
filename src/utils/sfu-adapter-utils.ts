import { SfuAdapter } from "../sfu-adapters/sfu-adapter";
import { SFU, SFU_CONNECTION_TYPE } from "../sfu-types";

type SfuConnectionParams = {
  sfuId: number;
  clientId: string;
  channelId: string;
  scene: Element | null;
  serverUrl?: string;
  serverParams?: { host: string; port: number; turn: any };
  sfuAccessToken?: string;
  sfuServerUrl?: string | string[];
  sfuRoomId?: string;
  signalingUrl?: string | string[];
  accessToken?: string;
  forceTcp?: boolean;
  forceTurn?: boolean;
  qs?: URLSearchParams;
  debug?: boolean;
};

export const connectSfu = async (sfu: SfuAdapter, params: SfuConnectionParams) => {
  switch (params.sfuId as SFU) {
    case SFU.LIVEKIT:
      sfu.connect({
        clientId: params.clientId,
        roomName: params.sfuRoomId || params.channelId,
        serverUrl: (params.sfuServerUrl as string) || params.serverUrl,
        accessToken: params.sfuAccessToken,
        scene: params.scene
      });
      break;
    case SFU.SORA:
      sfu.connect({
        clientId: params.clientId,
        channelId: params.sfuRoomId ||
          (params.channelId.includes("@") ? params.channelId : params.channelId + "@" + APP.sfu._roomId.split("@")[1]),
        scene: params.scene,
        signalingUrl: params.sfuServerUrl || params.signalingUrl,
        accessToken: params.sfuAccessToken || params.accessToken,
        debug: params.debug
      });
      break;
    case SFU.DIALOG:
    default:
      sfu.connect({
        clientId: params.clientId,
        roomId: params.channelId,
        scene: params.scene,
        serverUrl: params.serverUrl,
        serverParams: params.serverParams,
        forceTcp: params.forceTcp,
        forceTurn: params.forceTurn,
        iceTransportPolicy: params.forceTcp || params.forceTurn ? "relay" : "all"
      });
      break;
  }
};
