import { SFU } from "../sfu-types";
import { buildSfuConfig, SfuHubRecord, SfuJoinData } from "./sfu-config";

/** The hub record reticulum sends with `hub_refresh`: the Dialog host fields and the media server kind. */
export interface RefreshedHubRecord extends Partial<SfuHubRecord> {
  hub_id: string;
  sfu?: SFU | null;
}

/**
 * Moves the room's session to the media server a refreshed hub record names, without reloading the page.
 * LiveKit and Sora need a token, server URL and room id from reticulum first; Dialog is described by the
 * hub record itself, with the current config filling in anything the record lacks. Nothing happens before
 * the first connection, since the join reply decides the server then.
 */
export async function switchSfu(hub: RefreshedHubRecord, scene: Element | null): Promise<void> {
  const session = APP.sfu;
  const hubChannel = APP.hubChannel;
  const previous = session.config;
  const sfu = hub.sfu;
  if (sfu === undefined || sfu === null || session.sfuId === null || sfu === session.sfuId || !hubChannel) return;

  const joinData: SfuJoinData = { sfu, session_id: session.clientId };
  if (sfu !== SFU.DIALOG) {
    try {
      const { accessToken, serverUrl, roomId } = await hubChannel.fetchSfuToken();
      joinData.sfu_access_token = accessToken;
      joinData.sfu_server_url = serverUrl;
      joinData.sfu_room_id = roomId;
    } catch (error) {
      console.error(`Could not get the connection data for ${SFU[sfu]}, staying on the current media server:`, error);
      return;
    }
  }

  const dialogHost = previous?.kind === "dialog" ? previous : { host: "", port: 0, turn: null };
  const hubRecord: SfuHubRecord = {
    hub_id: hub.hub_id,
    host: hub.host || dialogHost.host,
    port: hub.port || dialogHost.port,
    turn: hub.turn || dialogHost.turn
  };

  console.log(`The room's media server changed to ${SFU[sfu]}, switching...`);
  await session.connect(buildSfuConfig(joinData, hubRecord, scene, new URLSearchParams(location.search), previous));
}
