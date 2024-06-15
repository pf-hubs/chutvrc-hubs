import { DialogAdapter } from "../naf-dialog-adapter";
import { SfuAdapter } from "../sfu-adapter";
import { SFU, SFU_CONNECTION_TYPE } from "../sfu-types";
import { SoraAdapter } from "../sora-adapter";

type SfuConnectionParams = {
  sfu: number;
  clientId: string;
  channelId: string;
  scene: Element | null;
  serverUrl?: string;
  serverParams?: { host: string; port: number; turn: any };
  signalingUrl?: string;
  accessToken?: string;
  forceTcp?: boolean;
  forceTurn?: boolean;
  qs?: URLSearchParams;
  debug?: boolean;
};

export const createSfuAdapter = ({
  sfuId,
  connectionType = SFU_CONNECTION_TYPE.SENDRECV
}: {
  sfuId?: number;
  connectionType: SFU_CONNECTION_TYPE;
}) => {
  if (sfuId) APP.sfuType = sfuId;
  switch (APP.sfuType) {
    case SFU.SORA:
      return new SoraAdapter(connectionType);
    default:
      return new DialogAdapter(connectionType);
  }
};

export const connectSfu = (sfu: SfuAdapter, params: SfuConnectionParams) => {
  switch (params.sfu || APP.sfuType) {
    case SFU.SORA:
      sfu.connect({
        clientId: params.clientId,
        channelId: params.channelId,
        scene: params.scene,
        signalingUrl: params.signalingUrl,
        accessToken: params.accessToken,
        debug: params.debug
      });
      break;
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
