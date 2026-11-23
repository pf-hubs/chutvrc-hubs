import { derivePublicSpeakingConfig } from "../sfu-adapters/sfu-config";
import { SFU_CONNECTION_TYPE } from "../sfu-types";
import { SfuSession } from "../sfu-adapters/sfu-session";

/**
 * Broadcasting across rooms. Three kinds of media session beside the room's own (APP.sfu):
 *
 * - speaking: a send-only session into the room "public_speaking", which the whole server shares, under
 *   the name "PS-" plus the own client id (APP.publicSpeakingSfu);
 * - listening: a receive-only session into that room (APP.publicSpeakersMirrorSfu);
 * - a relay per speaker the listening session hears: a send-only session into the listener's own room
 *   under the speaker's "PS-" name, which passes the voice and the data on, so everyone in the room gets
 *   the speaker as an ordinary participant (APP.publicSpeakerAgentSfus).
 *
 * Whenever what the menus show may have changed (speaking, listening, the room's list of speakers),
 * PUBLIC_SPEAKING_STATE_CHANGED is emitted on APP.sfu; the menus read the state from here and never keep
 * their own.
 */
export const PUBLIC_SPEAKING_STATE_CHANGED = "public-speaking-state-changed";

/** The name every speaker's client id starts with in the shared room and in a listening room */
const SPEAKER_PREFIX = "PS-";
/** A media server that needs a token to be joined; a Dialog room is joined with the room's permission token */
const NEEDS_SFU_TOKEN = { livekit: true, sora: true };
/** How often a session is asked whether it is connected, and for how long, in milliseconds */
const CONNECTED_POLL_MS = 200;
const CONNECTED_TIMEOUT_MS = 15000;

function emitStateChanged() {
  APP.sfu?.emit(PUBLIC_SPEAKING_STATE_CHANGED);
}

/** Resolves true once the session is connected, false when that takes too long or `isCurrent` says it was dropped */
function whenConnected(session, isCurrent) {
  return new Promise(resolve => {
    const started = performance.now();
    const check = () => {
      if (!isCurrent()) return resolve(false);
      if (session.isConnected) return resolve(true);
      if (performance.now() - started > CONNECTED_TIMEOUT_MS) return resolve(false);
      window.setTimeout(check, CONNECTED_POLL_MS);
    };
    check();
  });
}

export class PublicSpeakingSystem {
  /** The speakers this client relays into its room */
  static clientIds = [];

  constructor() {
    function tryTogglePublicSpeaker() {
      if (APP.sfu) {
        APP.sfu.on("toggle-public-speaker", ({ message }) => {
          const clientId = message.split("|")[0];
          const isOn = message.split("|")[1] === "1";
          PublicSpeakingSystem.setListedAsSpeaker(clientId, isOn);
          if (clientId !== APP.sfu.clientId) return;
          if (isOn) PublicSpeakingSystem.initPublicSpeaker();
          else PublicSpeakingSystem.closePublicSpeaker();
        });
      } else {
        window.setTimeout(tryTogglePublicSpeaker, 1000);
      }
    }

    tryTogglePublicSpeaker();
  }

  /** Whether this client is speaking to the other rooms */
  static get isSpeaking() {
    return !!APP.publicSpeakingSfu;
  }

  /** Whether this client is listening to the speakers and relaying them into its room */
  static get isListening() {
    return !!APP.publicSpeakersMirrorSfu;
  }

  /** Whether the room's list of speakers has the client, as an owner's "Enable public speak" put it there */
  static isListedAsSpeaker(clientId) {
    return APP.sfu.publicSpeakerClientIds.includes(clientId);
  }

  /** Puts the client on the room's list of speakers or takes it off, once */
  static setListedAsSpeaker(clientId, isOn) {
    const listed = APP.sfu.publicSpeakerClientIds;
    const index = listed.indexOf(clientId);
    if (isOn && index === -1) listed.push(clientId);
    else if (!isOn && index > -1) listed.splice(index, 1);
    else return;
    emitStateChanged();
  }

  static toggleRemotePublicSpeaker(clientId, isOn) {
    APP.sfu.broadcast("#togglePublicSpeaker", clientId + "|" + (isOn ? "1" : "0"));
    PublicSpeakingSystem.setListedAsSpeaker(clientId, isOn);
  }

  static async initPublicSpeaker() {
    if (APP.publicSpeakingSfu) {
      console.log("initPublicSpeaker: already broadcasting, ignoring duplicate start request");
      return;
    }
    console.log("initPublicSpeaker");
    const session = new SfuSession(SFU_CONNECTION_TYPE.SEND);
    session.hubChannel = APP.hubChannel;
    APP.publicSpeakingSfu = session;
    APP.sfu.emit("public-speaking-sfu-initialized");
    emitStateChanged();

    const isCurrent = () => APP.publicSpeakingSfu === session;
    try {
      await session.connect(
        derivePublicSpeakingConfig(APP.sfu.config, "public_speaking", SPEAKER_PREFIX + APP.sfu.clientId)
      );
    } catch (error) {
      console.error("Public speaking: the speaking session could not connect:", error);
      if (isCurrent()) PublicSpeakingSystem.closePublicSpeaker();
      return;
    }
    if (await whenConnected(session, isCurrent)) {
      session.setLocalMediaStream(APP.sfu.localMediaStream);
    } else if (isCurrent()) {
      console.error("Public speaking: the speaking session did not connect in time");
      PublicSpeakingSystem.closePublicSpeaker();
    }
  }

  static closePublicSpeaker() {
    const session = APP.publicSpeakingSfu;
    // Nothing to stop: an owner switched off a client that was not speaking
    if (!session) return;
    console.log("closePublicSpeaker");
    try {
      session.broadcast("#laserPointer", [0, 0, 0].join("|"));
    } catch (error) {
      // The session never connected: there is no laser to take away
    }
    Promise.resolve(session.disconnect()).catch(error =>
      console.error("Public speaking: failed to disconnect the speaking session:", error)
    );
    APP.sfu.emit("public-speaking-sfu-closed");
    APP.publicSpeakingSfu = null;
    emitStateChanged();
  }

  static async initPublicSpeakingMirroring() {
    if (APP.publicSpeakersMirrorSfu) {
      console.log("initPublicSpeakingMirroring: already mirroring, ignoring duplicate start request");
      return;
    }
    console.log("initPublicSpeakingMirroring");
    const session = new SfuSession(SFU_CONNECTION_TYPE.RECV);
    session.hubChannel = APP.hubChannel;
    APP.publicSpeakersMirrorSfu = session;
    session.on("stream_updated", this.mirrorPublicSpeaking, this);
    // A speaker who stops leaves the shared room: its relay goes, and listening goes on for the next one
    session.on("peer_left", this.closePublicSpeakerAgent, this);
    emitStateChanged();

    try {
      await session.connect(derivePublicSpeakingConfig(APP.sfu.config, "public_speaking", APP.sfu.clientId));
    } catch (error) {
      console.error("Public speaking: the listening session could not connect:", error);
      if (APP.publicSpeakersMirrorSfu === session) PublicSpeakingSystem.closePublicSpeakingMirroring();
    }
  }

  static async mirrorPublicSpeaking(clientId, kind) {
    if (!clientId.includes(SPEAKER_PREFIX) || kind !== "audio") return;
    const mirror = APP.publicSpeakersMirrorSfu;
    if (!mirror) return;
    if (!APP.publicSpeakerAgentSfus) APP.publicSpeakerAgentSfus = {};
    if (!APP.publicSpeakerAgentSfus[clientId]) {
      await this.initPublicSpeakerAgent(clientId);
    }
    const agent = APP.publicSpeakerAgentSfus?.[clientId];
    // The relay could not be started, or listening was stopped meanwhile
    if (!agent || APP.publicSpeakersMirrorSfu !== mirror) return;
    mirror.getMediaStream(clientId, "audio").then(stream => {
      if (APP.publicSpeakerAgentSfus?.[clientId] === agent) agent.setLocalMediaStream(stream);
    });
  }

  static closePublicSpeakingMirroring() {
    const mirror = APP.publicSpeakersMirrorSfu;
    if (mirror) {
      mirror.off("stream_updated", this.mirrorPublicSpeaking, this);
      mirror.off("peer_left", this.closePublicSpeakerAgent, this);
      Promise.resolve(mirror.disconnect()).catch(error =>
        console.error("Public speaking: failed to disconnect the listening session:", error)
      );
      APP.publicSpeakersMirrorSfu = null;
    }
    if (APP.publicSpeakerAgentSfus) {
      [...this.clientIds].forEach(clientId => this.closePublicSpeakerAgent(clientId));
      APP.publicSpeakerAgentSfus = null;
    }
    this.clientIds = [];
    emitStateChanged();
  }

  static mirrorDataChannelMessageFromSpeaker() {
    if (!APP.publicSpeakersMirrorSfu || !APP.publicSpeakerAgentSfus) return;
    this.clientIds.forEach(clientId => {
      if (APP.publicSpeakerAgentSfus[clientId]) {
        const relayed = APP.publicSpeakersMirrorSfu.bus.dequeueRelay();
        if (relayed) {
          APP.publicSpeakerAgentSfus[clientId].broadcastUint8(relayed.channelLabel, new Uint8Array(relayed.message));
        }
      }
    });
  }

  /**
   * Starts the relay of one speaker into the own room and waits until it is connected, so the speaker's
   * voice can be given to it. Only a media server that needs a token is asked for one: for a Dialog room
   * reticulum refuses the request, which used to end this function before the relay was connected.
   */
  static async initPublicSpeakerAgent(clientId) {
    if (!clientId.includes(SPEAKER_PREFIX)) return;
    if (APP.publicSpeakerAgentSfus?.[clientId]) {
      console.log("initPublicSpeakerAgent: agent already exists for", clientId, ", ignoring duplicate start request");
      return;
    }
    console.log("initPublicSpeakerAgent");
    const agent = new SfuSession(SFU_CONNECTION_TYPE.SEND);
    agent.hubChannel = APP.hubChannel;
    APP.publicSpeakerAgentSfus[clientId] = agent;
    this.clientIds.push(clientId);
    const isCurrent = () => APP.publicSpeakerAgentSfus?.[clientId] === agent;
    try {
      const sfuToken = NEEDS_SFU_TOKEN[APP.sfu.config.kind] ? await APP.hubChannel.getSfuTokenOrFetch() : undefined;
      if (!isCurrent()) return;
      await agent.connect(derivePublicSpeakingConfig(APP.sfu.config, APP.sfu.roomId, clientId, sfuToken));
      if (!(await whenConnected(agent, isCurrent)) && isCurrent()) throw new Error("the relay did not connect in time");
    } catch (error) {
      console.error(`Public speaking: the relay of ${clientId} could not be started:`, error);
      if (isCurrent()) this.closePublicSpeakerAgent(clientId);
    }
  }

  /** Stops the relay of one speaker, if this client runs one: the speaker left, or listening stops */
  static closePublicSpeakerAgent(clientId) {
    const agent = APP.publicSpeakerAgentSfus?.[clientId];
    const index = this.clientIds.indexOf(clientId);
    if (index > -1) this.clientIds.splice(index, 1);
    if (!agent) return;
    delete APP.publicSpeakerAgentSfus[clientId];
    Promise.resolve(agent.disconnect()).catch(error =>
      console.error(`Public speaking: failed to disconnect the relay of ${clientId}:`, error)
    );
  }
}
