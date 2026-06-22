// Audio chirp inject + detect over Web Audio.
//
// Speaker mode: mix a periodic 1 kHz tone burst into the outgoing mic stream.
// Passive mode: tap an incoming remote audio stream and run a Goertzel filter
// at 1 kHz. On detection (magnitude > k × background), log an event.

import { ProbeEvent } from "./types";

// 1 kHz is comfortably inside Chrome WebRTC's voice-band Opus encoding
// (which biases toward sub-1.5 kHz). Earlier attempt to move to 2.5 kHz
// to dodge a suspected chirp-loop.wav false-positive made the detector
// see zero energy post-Opus-encode (HF rolloff) — chirp-detect dropped
// to 0. chirp-loop.wav is now generated as silence (see
// eval/assets/generate-chirp.js), so the dominant residual bimodality
// in chirp-pairs.csv comes from Chrome headless audio jitter-buffer
// behaviour rather than from file content, and is handled by the
// DETECT_REFRACTORY_MS=500 bump below + post-filter on long-tail rows.
const CHIRP_HZ = 1000;
const CHIRP_DURATION_MS = 50;
// Inter-chirp interval. Aggregator's PAIRING_WINDOW_MS must stay strictly
// less than this (currently 4000 ms) to prevent cross-pairing emit[N] with
// detect[N+1].
const CHIRP_INTERVAL_MS = 5000;
const CHIRP_GAIN = 0.3; // mixed in well below clipping
const GOERTZEL_BLOCK = 1024; // ~21 ms at 48 kHz
const DETECT_THRESHOLD_FACTOR = 4; // peak vs rolling background
const DETECT_MIN_MAGNITUDE = 0.01; // absolute floor to avoid silence-floor amplification
// Was CHIRP_DURATION_MS * 2 = 100 ms. Bumped to 500 ms because some adapters
// (notably LiveKit Cloud with the MediaRecorder decoder-primer hack) cause
// the analyser to see a secondary peak ~1 s after the real chirp, leaving
// chirp-pairs.csv with bimodal latency distributions (~150 ms real,
// ~1.1 s echo). 500 ms is well above the echo window and still well below
// the 5 s inter-chirp interval, so we never accidentally suppress a real
// next-emit detection.
const DETECT_REFRACTORY_MS = 500;

let _audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!_audioCtx) {
    // Prefer Hubs' shared THREE.AudioContext. It's the same context the
    // positional-audio system uses for remote peers (when bot mode reaches
    // that path); routing our analyser into it means the same WebRTC
    // decoders that wake for the audio-system also feed the detector.
    // Creating our own private AudioContext leaves the inbound RTP audio
    // tracks without a consumer that Chrome counts — the decoder stays
    // idle, the analyser reads zeros.
    const shared = (window as any).THREE?.AudioContext?.getContext?.();
    if (shared) {
      _audioCtx = shared as AudioContext;
    } else {
      _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    // Browsers gate suspended contexts behind a user gesture (autoplay policy).
    // A passive listener registers once we know the ctx exists; the first gesture
    // resumes it and removes itself.
    const gestureEvents = ["pointerdown", "keydown", "touchstart", "click"];
    const onGesture = () => {
      _audioCtx?.resume().catch(() => {});
      for (const ev of gestureEvents) window.removeEventListener(ev, onGesture, true);
    };
    for (const ev of gestureEvents) window.addEventListener(ev, onGesture, true);
  }
  if (_audioCtx.state === "suspended") {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

export class ChirpInjector {
  private _ctx: AudioContext;
  private _emit: (event: ProbeEvent) => void;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _seq = 0;
  private _destNode: MediaStreamAudioDestinationNode | null = null;
  private _origSource: MediaStreamAudioSourceNode | null = null;
  private _wrapped = false;
  // Optional coincident-emit callback. Fired right after each chirp-emit with the
  // chirp's seq and emit timestamp, so the probe can drive a synchronized avatar
  // HEAD "slate" (see eval-probe sendHeadSlate). No-op when undefined.
  private _onChirpEmit?: (seq: number, tEmitMs: number) => void;

  constructor(
    emit: (event: ProbeEvent) => void,
    onChirpEmit?: (seq: number, tEmitMs: number) => void
  ) {
    this._ctx = getAudioContext();
    this._emit = emit;
    this._onChirpEmit = onChirpEmit;
  }

  // True once a chirp-injected stream exists; the patcher polls this to re-inject
  // after a late setLocalMediaStream patch (see SfuPatcher._tryPatch).
  get wrapped(): boolean {
    return this._wrapped;
  }

  // Returns a new MediaStream that contains the original mic mixed with chirps.
  wrap(stream: MediaStream): MediaStream {
    const ctx = this._ctx;
    this._origSource = ctx.createMediaStreamSource(stream);
    this._destNode = ctx.createMediaStreamDestination();
    // Mix chirps into the speaker's live mic so the listener both hears the speaker
    // and can detect the tone. Loud speaker audio can dilute the chirp below the
    // detector floor (watch chirp-tick SNR; raise CHIRP_GAIN if needed).
    this._origSource.connect(this._destNode);

    if (!this._timer) {
      this._timer = setInterval(() => this._emitChirp(), CHIRP_INTERVAL_MS);
    }

    // The returned stream replaces audio tracks with the mixed one but keeps
    // any video tracks from the original.
    const out = new MediaStream();
    this._destNode.stream.getAudioTracks().forEach(t => out.addTrack(t));
    stream.getVideoTracks().forEach(t => out.addTrack(t));
    this._wrapped = true;
    return out;
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private _emitChirp() {
    const ctx = this._ctx;
    if (!this._destNode) return;
    // Autoplay policy can leave the context suspended (silent chirp); resume it.
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const t_start = ctx.currentTime + 0.01;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = CHIRP_HZ;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t_start);
    gain.gain.linearRampToValueAtTime(CHIRP_GAIN, t_start + 0.005);
    gain.gain.setValueAtTime(CHIRP_GAIN, t_start + CHIRP_DURATION_MS / 1000 - 0.005);
    gain.gain.linearRampToValueAtTime(0, t_start + CHIRP_DURATION_MS / 1000);
    osc.connect(gain).connect(this._destNode);
    osc.start(t_start);
    osc.stop(t_start + CHIRP_DURATION_MS / 1000 + 0.05);
    const seq = this._seq++;
    // Log the moment the chirp _starts_ playing (in local performance.now() ms).
    // Convert from AudioContext time to performance.now() reference.
    const t_event = performance.now() + (t_start - ctx.currentTime) * 1000;
    this._emit({ kind: "chirp-emit", t_client_ms: t_event, seq });
    // Drive the coincident avatar HEAD slate (speaker mode only; no-op otherwise).
    this._onChirpEmit?.(seq, t_event);
  }
}

type DetectorEntry = {
  analyser: AnalyserNode;
  silentGain: GainNode;
  tracks: Set<string>;
  sources: MediaStreamAudioSourceNode[];
  primers: HTMLAudioElement[];
  stop: () => void;
};

export class ChirpDetector {
  private _ctx: AudioContext;
  private _emit: (event: ProbeEvent) => void;
  private _activeDetectors = new Map<string, DetectorEntry>();

  constructor(emit: (event: ProbeEvent) => void) {
    this._ctx = getAudioContext();
    this._emit = emit;
  }

  hasPeer(sourceClientId: string): boolean {
    return this._activeDetectors.has(sourceClientId);
  }

  // Attach a Goertzel analyzer to a remote peer's audio. The speaker may publish
  // SEVERAL audio tracks (its raw mic, the injected-chirp track, and LiveKit's own
  // mic publication), and the chirp is often NOT the first one — so mix ALL of the
  // peer's audio tracks into one analyser and force-decode each. Re-callable: tracks
  // that show up on later getMediaStream resolves are sourced in addition.
  attach(sourceClientId: string, stream: MediaStream): void {
    const tag = sourceClientId.slice(0, 8);
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      console.log("[eval-debug] chirp-detect attach SKIP (no audio tracks) cid=" + tag);
      return;
    }
    const ctx = this._ctx;
    let entry = this._activeDetectors.get(sourceClientId);
    if (!entry) {
      entry = this._createDetector(sourceClientId, tag);
      this._activeDetectors.set(sourceClientId, entry);
    }
    for (const track of audioTracks) {
      if (entry.tracks.has(track.id)) continue;
      entry.tracks.add(track.id);
      const single = new MediaStream([track]);
      // Decode primer, one per track: an <audio> element only renders its first
      // audio track, so a single element on a multi-track stream wouldn't force the
      // chirp track to decode. A hidden, muted element playing each track makes
      // Chrome produce PCM for it.
      try {
        const el = document.createElement("audio");
        el.srcObject = single;
        el.volume = 0;
        el.autoplay = true;
        el.setAttribute("playsinline", "true");
        el.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none;";
        document.body.appendChild(el);
        const playRes = el.play();
        if (playRes && typeof playRes.then === "function") playRes.catch(() => {});
        entry.primers.push(el);
      } catch (e) {
        // primer is best-effort
      }
      // Mix this track into the shared analyser (and the silent decode sink).
      const node = ctx.createMediaStreamSource(single);
      node.connect(entry.analyser);
      node.connect(entry.silentGain);
      entry.sources.push(node);
      console.log(
        "[eval-debug] chirp-detect sourced track cid=" +
          tag +
          " trackId=" +
          track.id.slice(0, 8) +
          " muted=" +
          track.muted +
          " enabled=" +
          track.enabled +
          " (tracks=" +
          entry.tracks.size +
          " ctxState=" +
          ctx.state +
          ")"
      );
    }
  }

  private _createDetector(sourceClientId: string, tag: string): DetectorEntry {
    const ctx = this._ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = GOERTZEL_BLOCK * 2;
    // Chrome only runs the inbound WebRTC decoder when the track has a *real*
    // downstream consumer (an AnalyserNode alone is a passive tap); route every
    // source through a silent destination too.
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;
    const sinkDest = ctx.createMediaStreamDestination();
    silentGain.connect(sinkDest);

    // Goertzel for CHIRP_HZ at sampleRate.
    const sampleRate = ctx.sampleRate;
    const k = Math.round((GOERTZEL_BLOCK * CHIRP_HZ) / sampleRate);
    const omega = (2 * Math.PI * k) / GOERTZEL_BLOCK;
    const coeff = 2 * Math.cos(omega);

    const buf = new Float32Array(GOERTZEL_BLOCK);
    let background = 0.001;
    let lastDetectMs = -Infinity;
    let maxMagWindow = 0;
    let lastDiagMs = -Infinity;
    let stopped = false;

    const entry: DetectorEntry = {
      analyser,
      silentGain,
      tracks: new Set<string>(),
      sources: [],
      primers: [],
      stop: () => {}
    };

    // setInterval (not requestAnimationFrame) so the detector ticks at a fixed
    // rate even in headless / backgrounded tabs. ~20 ms is faster than the chirp
    // burst (50 ms) and the refractory window, so every chirp is sampled twice.
    const TICK_MS = 20;
    const tick = () => {
      if (stopped) return;
      // Autoplay/background-tab policy can suspend the context (analyser reads
      // silence); keep it resumed.
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      analyser.getFloatTimeDomainData(buf);
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < GOERTZEL_BLOCK; i++) {
        const s = buf[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s;
      }
      const mag = Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / GOERTZEL_BLOCK;
      background = 0.99 * background + 0.01 * mag;
      if (mag > maxMagWindow) maxMagWindow = mag;
      const now = performance.now();
      if (now - lastDiagMs >= 1000) {
        this._emit({
          kind: "chirp-tick",
          t_client_ms: now,
          source_client_id: sourceClientId,
          magnitude: maxMagWindow,
          // bg = noise floor; ctx = context state; trk = how many of the peer's
          // audio tracks we're mixing (a silent run then shows if we sourced them).
          channel: "bg=" + background.toFixed(6) + ";ctx=" + ctx.state + ";trk=" + entry.tracks.size
        });
        maxMagWindow = 0;
        lastDiagMs = now;
      }
      if (
        mag > DETECT_MIN_MAGNITUDE &&
        mag > DETECT_THRESHOLD_FACTOR * background &&
        now - lastDetectMs > DETECT_REFRACTORY_MS
      ) {
        lastDetectMs = now;
        this._emit({
          kind: "chirp-detect",
          t_client_ms: now,
          source_client_id: sourceClientId,
          magnitude: mag
        });
      }
    };
    const timerId = setInterval(tick, TICK_MS);

    entry.stop = () => {
      stopped = true;
      clearInterval(timerId);
      for (const node of entry.sources) {
        try {
          node.disconnect();
        } catch (e) {
          // ignore
        }
      }
      for (const el of entry.primers) {
        try {
          el.pause();
          el.srcObject = null;
          el.remove();
        } catch (e) {
          // ignore
        }
      }
    };

    console.log(
      "[eval-debug] chirp-detect detector created cid=" +
        tag +
        " ctxState=" +
        ctx.state +
        " sampleRate=" +
        sampleRate
    );
    return entry;
  }

  detach(sourceClientId: string) {
    const d = this._activeDetectors.get(sourceClientId);
    if (d) {
      d.stop();
      this._activeDetectors.delete(sourceClientId);
    }
  }

  stopAll() {
    for (const [, d] of this._activeDetectors) d.stop();
    this._activeDetectors.clear();
  }
}
