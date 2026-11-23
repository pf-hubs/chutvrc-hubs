import { SFU } from "../sfu-types";

/**
 * TURN settings that reticulum sends with the hub record (`hub.turn`).
 */
export interface TurnConfig {
  enabled: boolean;
  username: string;
  credential: string;
  transports: Array<{ port: number }>;
}

/**
 * Where a Dialog server is. Reticulum sends this with the hub record and with `host_changed`.
 */
export interface DialogHost {
  host: string;
  port: number;
  turn?: TurnConfig | null;
}

interface SfuConfigBase {
  clientId: string;
  /** The A-Frame scene element, used for RTC debug events. Null for the public speaking adapters. */
  scene: Element | null;
}

export interface DialogConfig extends SfuConfigBase, DialogHost {
  kind: "dialog";
  roomId: string;
  forceTcp: boolean;
  forceTurn: boolean;
  iceTransportPolicy: "relay" | "all";
}

export interface LivekitConfig extends SfuConfigBase {
  kind: "livekit";
  roomName: string;
  serverUrl: string;
  /** When empty, the adapter fetches one from reticulum. */
  accessToken?: string;
}

export interface SoraConfig extends SfuConfigBase {
  kind: "sora";
  channelId: string;
  signalingUrls: string | string[];
  /** When empty, the adapter fetches one from reticulum. */
  accessToken?: string;
  debug: boolean;
}

/**
 * Everything an adapter needs to join a room, keyed on the media server kind.
 */
export type SfuConfig = DialogConfig | LivekitConfig | SoraConfig;

export type SfuKind = SfuConfig["kind"];

/**
 * The media server fields of reticulum's reply to joining or migrating to a hub.
 */
export interface SfuJoinData {
  sfu: SFU;
  session_id: string;
  sfu_access_token?: string;
  sfu_server_url?: string;
  sfu_room_id?: string;
  sora_channel_id?: string;
  sora_signaling_url?: string | string[];
  sora_access_token?: string;
  sora_is_debug?: boolean;
}

export interface SfuHubRecord extends DialogHost {
  hub_id: string;
}

/**
 * Builds the config for the room described by reticulum's join reply.
 *
 * `previous` is the config of the adapter's last connection, if any. It is only needed for
 * Sora when reticulum sends no `sfu_room_id`: the channel id then takes the `@project` suffix
 * of the previous room.
 */
export function buildSfuConfig(
  joinData: SfuJoinData,
  hub: SfuHubRecord,
  scene: Element | null,
  qs: URLSearchParams,
  previous?: SfuConfig | null
): SfuConfig {
  const clientId = joinData.session_id;
  const channelId = joinData.sora_channel_id || hub.hub_id;

  switch (joinData.sfu) {
    case SFU.LIVEKIT:
      return {
        kind: "livekit",
        clientId,
        scene,
        roomName: joinData.sfu_room_id || channelId,
        // Without a LiveKit URL from reticulum this falls back to the hub's Dialog server, as it always has.
        serverUrl: joinData.sfu_server_url || `wss://${hub.host}:${hub.port}`,
        accessToken: joinData.sfu_access_token
      };
    case SFU.SORA:
      return {
        kind: "sora",
        clientId,
        scene,
        channelId: joinData.sfu_room_id || withSoraProject(channelId, previous),
        signalingUrls: joinData.sfu_server_url || joinData.sora_signaling_url || "",
        accessToken: joinData.sfu_access_token || joinData.sora_access_token,
        debug: Boolean(joinData.sora_is_debug)
      };
    case SFU.DIALOG:
    default: {
      const forceTcp = Boolean(qs.get("force_tcp"));
      const forceTurn = Boolean(qs.get("force_turn"));
      return {
        kind: "dialog",
        clientId,
        scene,
        roomId: channelId,
        host: hub.host,
        port: hub.port,
        turn: hub.turn,
        forceTcp,
        forceTurn,
        iceTransportPolicy: forceTcp || forceTurn ? "relay" : "all"
      };
    }
  }
}

/**
 * Builds the config for one of the public speaking adapters (the speaker's sender, the
 * listeners' mirror, or a speaker's agent in the listeners' room). It joins `roomId` on the
 * same server as `base`, with `clientId` as its identity.
 *
 * `accessToken` is for LiveKit and Sora. When empty, LiveKit fetches one from reticulum and
 * Sora uses the public speaking channel token from the build environment.
 */
export function derivePublicSpeakingConfig(
  base: SfuConfig,
  roomId: string,
  clientId: string,
  accessToken?: string
): SfuConfig {
  switch (base.kind) {
    case "livekit":
      return { ...base, clientId, scene: null, roomName: roomId, accessToken };
    case "sora":
      return {
        ...base,
        clientId,
        scene: null,
        channelId: roomId.includes("@") ? roomId : `${roomId}@${base.channelId.split("@")[1]}`,
        accessToken: accessToken || process.env.SORA_PUBLIC_SPEAKING_CHANNEL_TOKEN,
        debug: false
      };
    case "dialog":
      return { ...base, clientId, scene: null, roomId };
  }
}

/**
 * The same room on another Dialog server, for reticulum's `host_changed` event.
 * Configs of other server kinds are returned unchanged.
 */
export function withDialogHost(config: SfuConfig, { host, port, turn }: DialogHost): SfuConfig {
  if (config.kind !== "dialog") return config;
  return { ...config, host, port, turn };
}

/**
 * Reticulum sends `sfu_room_id` as `<hub id>@<project>`. When it is missing, the project is
 * taken from the room the adapter was last connected to.
 */
function withSoraProject(channelId: string, previous?: SfuConfig | null): string {
  if (channelId.includes("@")) return channelId;
  const project = previous?.kind === "sora" ? previous.channelId.split("@")[1] : undefined;
  return project === undefined ? channelId : `${channelId}@${project}`;
}
