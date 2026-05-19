// Instance-patches APP.sfu's setLocalMediaStream and getMediaStream to tap
// audio without modifying any adapter source. Re-patches when APP.sfu changes
// identity (e.g., room SFU swap).

import { ChirpInjector, ChirpDetector } from "./audio-chirp";
import { ProbeEvent, ProbeMode } from "./types";

export class SfuPatcher {
  private _app: any;
  private _mode: ProbeMode;
  private _emit: (event: ProbeEvent) => void;
  private _injector: ChirpInjector | null = null;
  private _detector: ChirpDetector | null = null;
  private _patchedSfus = new WeakSet<object>();
  private _pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(app: any, mode: ProbeMode, emit: (event: ProbeEvent) => void) {
    this._app = app;
    this._mode = mode;
    this._emit = emit;
    if (mode === "speaker") this._injector = new ChirpInjector(emit);
    this._detector = new ChirpDetector(emit);
  }

  start() {
    this._tryPatch();
    this._pollTimer = setInterval(() => this._tryPatch(), 2000);
  }

  stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this._injector?.stop();
    this._detector?.stopAll();
  }

  // Called from peer-leave hook to clean up the per-peer detector.
  detachPeer(clientId: string) {
    this._detector?.detach(clientId);
  }

  private _tryPatch() {
    const sfu = this._app?.sfu;
    if (!sfu || typeof sfu !== "object") return;
    if (this._patchedSfus.has(sfu)) return;
    this._patchedSfus.add(sfu);

    if (this._mode === "speaker" && this._injector) {
      const orig = sfu.setLocalMediaStream;
      if (typeof orig === "function") {
        const injector = this._injector;
        sfu.setLocalMediaStream = function (this: any, stream: MediaStream | null, hints?: any) {
          const wrapped = stream && stream.getAudioTracks && stream.getAudioTracks().length > 0
            ? injector.wrap(stream)
            : stream;
          return orig.call(this, wrapped, hints);
        };
      }
    }

    const detector = this._detector;
    if (detector) {
      const orig = sfu.getMediaStream;
      if (typeof orig === "function") {
        sfu.getMediaStream = function (this: any, clientId: string, kind?: string) {
          const result = orig.call(this, clientId, kind);
          // Adapter signatures default `kind` to "audio" — match both explicit and omitted.
          // Adapters return either MediaStream | null OR Promise<MediaStream | null>; handle both.
          if (kind === undefined || kind === "audio") {
            const attachIfAudio = (stream: any) => {
              if (stream && typeof stream.getAudioTracks === "function") {
                try {
                  detector.attach(clientId, stream as MediaStream);
                } catch (e) {
                  // ignore; audio context not ready, or stream malformed
                }
              }
            };
            if (result && typeof (result as Promise<any>).then === "function") {
              (result as Promise<any>).then(attachIfAudio, () => {});
            } else {
              attachIfAudio(result);
            }
          }
          return result;
        };
      }
    }
  }
}
