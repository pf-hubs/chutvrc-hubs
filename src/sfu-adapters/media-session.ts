import { debug as newDebug } from "debug";
import { SFU_CONNECTION_TYPE } from "../sfu-types";
import { MediaDevices } from "../utils/media-devices-utils";
import { CrossRoomStreamerAudioSource } from "../components/cross-room-streamer-audio-source";
import type { SfuAdapter } from "./sfu-adapter";

const debug = newDebug("media-session:debug");

/** The three local tracks a client can publish. */
export type LocalTrackKind = "microphone" | "camera" | "screen";

/** The adapter-specific parts of media handling, bound by the base adapter. */
export interface MediaDriver {
  /** Publishes a local track that was not published before. */
  publishTrack(kind: LocalTrackKind, track: MediaStreamTrack): Promise<void>;
  /** Swaps the track under an existing publication of the kind. */
  replaceTrack(kind: LocalTrackKind, track: MediaStreamTrack): Promise<void>;
  /** Removes the publication of the kind, if any. */
  unpublishTrack(kind: LocalTrackKind): Promise<void>;
  /** Applies the microphone state in the SDK. Returns false when there was nothing to apply it to. */
  setMicEnabled(enabled: boolean): boolean;
  /** The microphone state as the SDK sees it. */
  micEnabled(): boolean | null;
  /** The local tracks of a kind for getMediaStream of the own client. */
  localTracks(kind: string): MediaStreamTrack[];
  /** Runs before a new local stream is applied. Returns false to leave the stream unapplied. */
  beforeLocalStreamApplied(stream: MediaStream): boolean;
  /** Runs after a new local stream has been applied and remembered. */
  afterLocalStreamApplied(stream: MediaStream): Promise<void>;
}

export interface MediaSessionOptions {
  /** Rejects a pending getMediaStream after this many milliseconds. Unset, a request waits without limit. */
  pendingTimeoutMs?: number;
}

interface PendingMediaRequest {
  resolve: (stream: MediaStream | null) => void;
  reject: (error: Error) => void;
}

type LocalTracks = Partial<Record<LocalTrackKind, MediaStreamTrack>>;

const VIDEO_TRACK_KINDS: LocalTrackKind[] = ["camera", "screen"];

/**
 * The part of media handling that is the same for every SFU: the remote streams by client,
 * the requests waiting for a remote or local track, the local stream and the tracks published
 * from it, the microphone state, and the audio of public speakers played from their agents.
 * Each adapter drives its SDK through a MediaDriver.
 */
export class MediaSession {
  private readonly adapter: SfuAdapter;
  private readonly driver: MediaDriver;
  private readonly options: MediaSessionOptions;

  private remoteStreams = new Map<string, MediaStream>();
  private pending = new Map<string, Partial<Record<string, PendingMediaRequest>>>();

  private stream: MediaStream | null = null;
  private tracks: LocalTracks = {};
  private micWanted = false;

  private publicSpeakerAudioSources: Record<string, CrossRoomStreamerAudioSource> = {};

  constructor(adapter: SfuAdapter, driver: MediaDriver, options: MediaSessionOptions = {}) {
    this.adapter = adapter;
    this.driver = driver;
    this.options = options;
  }

  // ----- Remote streams -----

  /** The stream for a client, or a pending promise for it until the driver reports its track. */
  getMediaStream(clientId: string, kind: string = "audio"): Promise<MediaStream | null> {
    const connectionType = this.adapter._connectionType;
    const isSelf = this.adapter._clientId === clientId && connectionType !== SFU_CONNECTION_TYPE.RECV;
    const isOther = this.adapter._clientId !== clientId && connectionType !== SFU_CONNECTION_TYPE.SEND;

    let tracks: MediaStreamTrack[] = [];
    if (isSelf) {
      tracks = this.driver.localTracks(kind);
    } else if (isOther) {
      tracks = this.remoteTracks(clientId, kind);
    }

    if (tracks.length > 0) {
      debug(`Already had ${kind} for ${clientId}`);
      return Promise.resolve(new MediaStream(tracks));
    }

    debug(`Waiting on ${kind} for ${clientId}`);
    let requests = this.pending.get(clientId);
    if (!requests) {
      requests = {};
      this.pending.set(clientId, requests);
    }
    const promise = new Promise<MediaStream | null>((resolve, reject) => {
      requests![kind] = { resolve, reject };
      if (this.options.pendingTimeoutMs !== undefined) {
        setTimeout(() => {
          if (requests![kind]) {
            reject(new Error(`Timeout waiting for ${kind} stream from ${clientId}`));
            delete requests![kind];
          }
        }, this.options.pendingTimeoutMs);
      }
    });
    promise.catch(e => {
      this.adapter.emitRTCEvent("error", "Adapter", () => `getMediaStream error: ${e}`);
      console.warn(`${clientId} getMediaStream Error`, e);
    });
    return promise;
  }

  /** The stream kept for a remote client, if any. */
  remoteStream(clientId: string): MediaStream | undefined {
    return this.remoteStreams.get(clientId);
  }

  /** Keeps a track the driver received for a client and resolves the request waiting for it. */
  addRemoteTrack(clientId: string, kind: string, track: MediaStreamTrack): void {
    let stream = this.remoteStreams.get(clientId);
    if (!stream) {
      stream = new MediaStream();
      this.remoteStreams.set(clientId, stream);
    }
    if (!stream.getTracks().includes(track)) {
      stream.addTrack(track);
    }
    this.resolvePending(clientId, kind, new MediaStream([track]));
  }

  /** Drops a track the driver no longer receives for a client. */
  removeRemoteTrack(clientId: string, track: MediaStreamTrack): void {
    this.remoteStreams.get(clientId)?.removeTrack(track);
  }

  /** Keeps a whole stream the SDK owns for a client and resolves the requests its tracks can answer. */
  setRemoteStream(clientId: string, stream: MediaStream): void {
    this.remoteStreams.set(clientId, stream);
    for (const kind of ["audio", "video"]) {
      const tracks = this.remoteTracks(clientId, kind);
      if (tracks.length > 0) this.resolvePending(clientId, kind, new MediaStream(tracks));
    }
  }

  /**
   * Forgets a client that left. Its waiting requests are rejected with the error when one is given,
   * and resolved with null otherwise.
   */
  removePeer(clientId: string, error?: Error): void {
    this.remoteStreams.delete(clientId);
    const requests = this.pending.get(clientId);
    if (!requests) return;
    debug(`${clientId} left before its media stream was resolved`);
    for (const request of Object.values(requests)) {
      if (!request) continue;
      if (error) {
        request.reject(error);
      } else {
        request.resolve(null);
      }
    }
    this.pending.delete(clientId);
  }

  /** Forgets every remote stream and waiting request, without settling the requests. */
  clearRemote(): void {
    this.remoteStreams.clear();
    this.pending.clear();
  }

  private remoteTracks(clientId: string, kind: string): MediaStreamTrack[] {
    const stream = this.remoteStreams.get(clientId);
    if (!stream) return [];
    return kind === "audio" ? stream.getAudioTracks() : stream.getVideoTracks();
  }

  private resolvePending(clientId: string, kind: string, stream: MediaStream): void {
    const requests = this.pending.get(clientId);
    if (!requests) return;
    const request = requests[kind];
    if (request) {
      delete requests[kind];
      request.resolve(stream);
    }
    if (Object.keys(requests).length === 0) {
      this.pending.delete(clientId);
    }
  }

  // ----- Public speakers -----

  /**
   * Plays a public speaker's audio from its agent avatar in this room. Without a stream the speaker's
   * audio stream is awaited first. Keeps trying every second until the avatar exists.
   */
  async tryAttachAudioToPublicSpeakerAgent(clientId: string, stream?: MediaStream): Promise<void> {
    if (!clientId.includes("PS-") || this.adapter._roomId.includes("public_speaking")) return;

    try {
      const audio = stream ?? (await this.getMediaStream(clientId, "audio"));
      if (!audio) return;

      const sources = this.publicSpeakerAudioSources;
      sources[clientId] = new CrossRoomStreamerAudioSource(new MediaStream(audio));

      const tryAttachAudioToAvatar = (): void => {
        const avatarEid = this.adapter._avatarSyncHelper._client2AvatarEid.get(clientId);
        if (avatarEid) {
          const avatarObj = APP.world.eid2obj.get(avatarEid);
          if (avatarObj) {
            sources[clientId].attachAudio(avatarObj);
            return;
          }
        }
        if (sources[clientId] && !sources[clientId].node) {
          window.setTimeout(tryAttachAudioToAvatar, 1000);
        }
      };

      tryAttachAudioToAvatar();
    } catch (error) {
      console.error(`Error attaching audio to public speaker ${clientId}:`, error);
    }
  }

  /** Stops playing a public speaker's audio from its agent. */
  removePublicSpeakerAudio(clientId: string): void {
    const source = this.publicSpeakerAudioSources[clientId];
    if (!source) return;
    source.remove?.();
    delete this.publicSpeakerAudioSources[clientId];
  }

  // ----- Local stream -----

  /** The last local stream set, or the one the adapter acquired itself. */
  get localStream(): MediaStream | null {
    return this.stream;
  }

  /** The published local track of a kind. */
  localTrack(kind: LocalTrackKind): MediaStreamTrack | undefined {
    return this.tracks[kind];
  }

  /** The published local tracks for a media kind: the microphone, or the camera and otherwise the screen. */
  publishedTracks(kind: string): MediaStreamTrack[] {
    const track = kind === "audio" ? this.tracks.microphone : this.tracks.camera ?? this.tracks.screen;
    return track ? [track] : [];
  }

  /** Remembers a local stream without publishing it. */
  rememberLocalStream(stream: MediaStream | null): void {
    this.stream = stream;
  }

  /** Records a track the adapter published itself. */
  registerLocalTrack(kind: LocalTrackKind, track: MediaStreamTrack): void {
    this.tracks[kind] = track;
  }

  /** Forgets the published tracks after the adapter's publications went away; the stream is kept. */
  forgetLocalTracks(): void {
    this.tracks = {};
  }

  /** Forgets the local stream and its published tracks. */
  clearLocal(): void {
    this.stream = null;
    this.tracks = {};
  }

  /**
   * Publishes the tracks of a new local stream: the audio track as the microphone and, when the content
   * hints say so, a video track as the camera or the screen. Tracks already published stay as they are,
   * a changed track is replaced, and a kind the stream no longer has is unpublished. Publishing the camera
   * unpublishes the screen first and the other way round.
   */
  async setLocalMediaStream(
    stream: MediaStream,
    videoContentHintByTrackId: Map<string, string> | null = null
  ): Promise<void> {
    if (this.adapter._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    if (!this.driver.beforeLocalStreamApplied(stream)) return;

    const microphone = stream.getAudioTracks()[0];
    const videoTracks = stream.getVideoTracks();
    let camera: MediaStreamTrack | undefined;
    let screen: MediaStreamTrack | undefined;
    for (const track of videoTracks) {
      const contentHint = videoContentHintByTrackId?.get(track.id);
      if (contentHint === MediaDevices.SCREEN) {
        screen = track;
      } else if (contentHint === MediaDevices.CAMERA) {
        camera = track;
      }
    }

    if (microphone) {
      await this.applyLocalTrack("microphone", microphone);
    } else if (this.tracks.microphone) {
      await this.dropLocalTrack("microphone");
    }

    if (videoTracks.length === 0) {
      for (const kind of VIDEO_TRACK_KINDS) {
        if (this.tracks[kind]) await this.dropLocalTrack(kind);
      }
    }
    if (camera) {
      if (this.tracks.screen) await this.dropLocalTrack("screen");
      await this.applyLocalTrack("camera", camera);
    }
    if (screen) {
      if (this.tracks.camera) await this.dropLocalTrack("camera");
      await this.applyLocalTrack("screen", screen);
    }

    this.stream = stream;

    // A request for the own stream is answered with the stream's track of that kind
    if (microphone) this.resolvePending(this.adapter._clientId, "audio", new MediaStream([microphone]));
    if (videoTracks[0]) this.resolvePending(this.adapter._clientId, "video", new MediaStream([videoTracks[0]]));

    await this.driver.afterLocalStreamApplied(stream);
  }

  private async applyLocalTrack(kind: LocalTrackKind, track: MediaStreamTrack): Promise<void> {
    const current = this.tracks[kind];
    if (current === track) return;
    if (current) {
      await this.driver.replaceTrack(kind, track);
    } else {
      await this.driver.publishTrack(kind, track);
    }
    this.tracks[kind] = track;
  }

  private async dropLocalTrack(kind: LocalTrackKind): Promise<void> {
    delete this.tracks[kind];
    await this.driver.unpublishTrack(kind);
  }

  // ----- Microphone -----

  /** Whether the microphone was last asked to be on. */
  get micShouldBeEnabled(): boolean {
    return this.micWanted;
  }

  get isMicEnabled(): boolean | null {
    if (this.adapter._connectionType === SFU_CONNECTION_TYPE.RECV) return false;
    return this.driver.micEnabled();
  }

  enableMicrophone(enabled: boolean): void {
    if (this.adapter._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    if (!this.driver.setMicEnabled(enabled)) return;
    this.micWanted = enabled;
    this.adapter.emit("mic-state-changed", { enabled });
  }

  toggleMicrophone(): void {
    this.enableMicrophone(!this.micWanted);
  }
}
