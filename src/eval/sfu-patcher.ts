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
  // Set once sfu.setLocalMediaStream is wrapped; gates chirp re-injection.
  private _slmsPatched = false;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  // Chrome won't actually decode an inbound RTCRtpReceiver audio track into
  // PCM samples for WebAudio unless something consumes the track. Hubs does
  // this routing automatically for LiveKit/Dialog in its normal audio
  // pipeline, but the path doesn't run cleanly for bot-mode Sora, so the
  // detector reads pure silence (maxMag stays at 0.0 for the entire run).
  // Old-headless Chrome 100 is also harder to wake than newer Chrome, so
  // we use two parallel forcing mechanisms per peer:
  //   - a hidden <audio> element in the DOM with srcObject + .play()
  //   - a MediaRecorder on the stream that needs PCM to encode chunks
  // The MediaRecorder is the bulletproof one — it's a guaranteed real
  // consumer that Chrome cannot optimize away. Both are kept alive so GC
  // doesn't tear down the decode pipeline.
  private _decoderSinks = new Map<string, HTMLAudioElement>();
  private _decoderRecorders = new Map<string, MediaRecorder>();

  constructor(
    app: any,
    mode: ProbeMode,
    emit: (event: ProbeEvent) => void,
    onChirpEmit?: (seq: number, tEmitMs: number) => void
  ) {
    this._app = app;
    this._mode = mode;
    this._emit = emit;
    if (mode === "speaker") this._injector = new ChirpInjector(emit, onChirpEmit);
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
    // Tear down the per-peer decoder-primer audio elements and recorders.
    for (const audioEl of this._decoderSinks.values()) {
      try {
        audioEl.pause();
        audioEl.srcObject = null;
        if (audioEl.parentNode) audioEl.parentNode.removeChild(audioEl);
      } catch (e) {
        // ignore
      }
    }
    this._decoderSinks.clear();
    for (const recorder of this._decoderRecorders.values()) {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch (e) {
        // ignore
      }
    }
    this._decoderRecorders.clear();
  }

  // Called from peer-leave hook to clean up the per-peer detector.
  detachPeer(clientId: string) {
    this._detector?.detach(clientId);
    const sink = this._decoderSinks.get(clientId);
    if (sink) {
      try {
        sink.pause();
        sink.srcObject = null;
        if (sink.parentNode) sink.parentNode.removeChild(sink);
      } catch (e) {
        // ignore
      }
      this._decoderSinks.delete(clientId);
    }
    const recorder = this._decoderRecorders.get(clientId);
    if (recorder) {
      try {
        if (recorder.state !== "inactive") recorder.stop();
      } catch (e) {
        // ignore
      }
      this._decoderRecorders.delete(clientId);
    }
  }

  private _tryPatch() {
    const sfu = this._app?.sfu;
    if (!sfu || typeof sfu !== "object") return;

    // Speaker bots need the mic ON so the chirp-injected audio actually
    // goes over the wire. Hubs adapters start with mic disabled
    // (enableMicrophone(false)) because real users click a UI button to
    // unmute — eval bots never do. Without this, every remote audio track
    // shows up with `muted=true` and the Goertzel analyser reads silence.
    // Idempotent — fine to call on every 2 s poll.
    if (this._mode === "speaker" && typeof sfu.enableMicrophone === "function") {
      try {
        // isMicEnabled may be true / false / null / undefined depending on
        // adapter readiness. Only call enable when it's clearly not on.
        if (sfu.isMicEnabled !== true) {
          sfu.enableMicrophone(true);
          console.log(
            "[eval-debug] sfu-patcher forced mic ON (speaker mode), was=" +
              String(sfu.isMicEnabled)
          );
        }
      } catch (e) {
        // ignore — adapter not fully ready yet, will retry next poll
      }
    }

    // Re-inject if the speaker's mic was published before our setLocalMediaStream
    // patch landed (a real-browser entry race: the live track then has no chirp).
    // Re-publish the current local stream through the now-patched method so the
    // chirp goes on the wire. Runs each poll until it takes; no-op once wrapped.
    if (
      this._mode === "speaker" &&
      this._injector &&
      this._slmsPatched &&
      !this._injector.wrapped &&
      typeof sfu.getLocalMediaStream === "function" &&
      typeof sfu.setLocalMediaStream === "function"
    ) {
      const local = sfu.getLocalMediaStream();
      if (local && local.getAudioTracks && local.getAudioTracks().length > 0) {
        console.log("[eval-debug] sfu-patcher re-injecting chirp (mic published before patch landed)");
        sfu.setLocalMediaStream(local);
      }
    }

    if (this._patchedSfus.has(sfu)) return;
    this._patchedSfus.add(sfu);

    // Speaker mode also needs the enableMicrophone() method itself patched
    // so any future enableMicrophone(false) call is a no-op. Hubs entry flow
    // calls enableMicrophone(false) at multiple points (adapter init's
    // "start muted by default", then again from media-devices-manager when
    // setLocalMediaStream re-runs). Without intercepting, the speaker's
    // outgoing audio track flips muted=true between our 2 s poll ticks and
    // chirps reach listeners only intermittently.
    if (this._mode === "speaker") {
      const origEnableMic = sfu.enableMicrophone;
      if (typeof origEnableMic === "function") {
        sfu.enableMicrophone = function (this: any, _enabled: boolean) {
          // Force-on for speaker bots; ignore the requested value.
          return origEnableMic.call(this, true);
        };
        console.log("[eval-debug] sfu-patcher patched enableMicrophone to force-on (speaker)");
      }
    }

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
        this._slmsPatched = true;
      }
    }

    const detector = this._detector;
    const sinks = this._decoderSinks;
    const recorders = this._decoderRecorders;
    if (detector) {
      const orig = sfu.getMediaStream;
      if (typeof orig === "function") {
        sfu.getMediaStream = function (this: any, clientId: string, kind?: string) {
          const result = orig.call(this, clientId, kind);
          // Adapter signatures default `kind` to "audio" — match both explicit and omitted.
          // Adapters return either MediaStream | null OR Promise<MediaStream | null>; handle both.
          if (kind === undefined || kind === "audio") {
            const tag = clientId.slice(0, 8);
            const isPromise = result && typeof (result as Promise<any>).then === "function";
            console.log(
              "[eval-debug] sfu-patcher getMediaStream wrap cid=" +
                tag +
                " kind=" +
                kind +
                " resultType=" +
                (isPromise ? "Promise" : result ? "MediaStream" : String(result))
            );
            const attachIfAudio = (stream: any) => {
              const audioCount =
                stream && typeof stream.getAudioTracks === "function"
                  ? stream.getAudioTracks().length
                  : -1;
              console.log(
                "[eval-debug] sfu-patcher resolve cid=" +
                  tag +
                  " audioTracks=" +
                  audioCount
              );
              if (stream && typeof stream.getAudioTracks === "function") {
                // Force Chrome's inbound audio decoder to actually produce
                // PCM samples for WebAudio: a hidden, muted <audio> element
                // with .play() is the standard workaround. Kept alive in
                // _decoderSinks to prevent GC tearing down the decode pipe.
                if (!sinks.has(clientId)) {
                  try {
                    const audioEl = document.createElement("audio");
                    audioEl.srcObject = stream as MediaStream;
                    audioEl.volume = 0;
                    audioEl.autoplay = true;
                    audioEl.setAttribute("playsinline", "true");
                    audioEl.style.cssText =
                      "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
                    document.body.appendChild(audioEl);
                    const playRes = audioEl.play();
                    if (playRes && typeof playRes.then === "function") {
                      playRes.catch(err =>
                        console.log("[eval-debug] sfu-patcher sink play() rejected cid=" + tag + " err=" + err)
                      );
                    }
                    sinks.set(clientId, audioEl);
                    console.log(
                      "[eval-debug] sfu-patcher sink attached cid=" + tag + " (decoder primer in DOM)"
                    );
                  } catch (e) {
                    console.log("[eval-debug] sfu-patcher sink threw cid=" + tag + " err=" + e);
                  }
                }
                // Bulletproof decoder primer: MediaRecorder needs PCM
                // samples to encode chunks, so attaching one to the stream
                // forces Chrome's WebRTC decoder live regardless of the
                // <audio> element behaviour. Old-headless Chrome 100 needs
                // this even with the <audio> element present.
                if (!recorders.has(clientId)) {
                  try {
                    // Pick a mimeType the browser actually supports.
                    let mimeType = "";
                    const candidates = [
                      "audio/webm;codecs=opus",
                      "audio/webm",
                      "audio/ogg;codecs=opus",
                      "audio/mp4"
                    ];
                    for (const t of candidates) {
                      if ((window as any).MediaRecorder?.isTypeSupported?.(t)) {
                        mimeType = t;
                        break;
                      }
                    }
                    const recorder = new MediaRecorder(stream as MediaStream, mimeType ? { mimeType } : undefined);
                    recorder.ondataavailable = () => {
                      // Discard. The point is to force the decoder, not to save audio.
                    };
                    recorder.onerror = (e: any) => {
                      console.log("[eval-debug] sfu-patcher recorder error cid=" + tag + " err=" + e);
                    };
                    // 1000 ms chunks. We previously used 100 ms because we
                    // thought the chunk-buffer was adding latency to chirp
                    // detection — but the chirp arrives via the <audio>
                    // element / analyser chain, NOT via the recorder. The
                    // recorder is only here as a decoder-primer (its mere
                    // existence forces Chrome to run the WebRTC audio
                    // decoder for the inbound track). The chunk timeslice
                    // therefore has zero effect on detection latency.
                    // At N=10 the 100 ms timeslice fired ~90 chunk events
                    // per second across all peers, choking the bot's main
                    // thread (avatar pump dropped from 67 Hz to 13 Hz,
                    // pose-pairs p95 hit 82 s). 1000 ms drops that to ~9
                    // events/sec — same priming effect, ~10× less CPU.
                    recorder.start(1000);
                    recorders.set(clientId, recorder);
                    console.log(
                      "[eval-debug] sfu-patcher recorder attached cid=" +
                        tag +
                        " mime=" +
                        (mimeType || "default")
                    );
                  } catch (e) {
                    console.log("[eval-debug] sfu-patcher recorder threw cid=" + tag + " err=" + e);
                  }
                }
                try {
                  detector.attach(clientId, stream as MediaStream);
                } catch (e) {
                  console.log("[eval-debug] sfu-patcher attach threw cid=" + tag + " err=" + e);
                }
              }
            };
            if (isPromise) {
              (result as Promise<any>).then(attachIfAudio, (err: any) =>
                console.log("[eval-debug] sfu-patcher promise rejected cid=" + tag + " err=" + err)
              );
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
