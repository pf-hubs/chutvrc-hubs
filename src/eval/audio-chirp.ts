// Audio chirp inject + detect over Web Audio.
//
// Speaker mode: mix a periodic 1 kHz tone burst into the outgoing mic stream.
// Passive mode: tap an incoming remote audio stream and run a Goertzel filter
// at 1 kHz. On detection (magnitude > k × background), log an event.

import { ProbeEvent } from "./types";

const CHIRP_HZ = 1000;
const CHIRP_DURATION_MS = 50;
const CHIRP_INTERVAL_MS = 1500;
const CHIRP_GAIN = 0.3; // mixed in well below clipping
const GOERTZEL_BLOCK = 1024; // ~21 ms at 48 kHz
const DETECT_THRESHOLD_FACTOR = 4; // peak vs rolling background
const DETECT_MIN_MAGNITUDE = 0.01; // absolute floor to avoid silence-floor amplification
const DETECT_REFRACTORY_MS = CHIRP_DURATION_MS * 2;

let _audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
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

  constructor(emit: (event: ProbeEvent) => void) {
    this._ctx = getAudioContext();
    this._emit = emit;
  }

  // Returns a new MediaStream that contains the original mic mixed with chirps.
  wrap(stream: MediaStream): MediaStream {
    const ctx = this._ctx;
    this._origSource = ctx.createMediaStreamSource(stream);
    this._destNode = ctx.createMediaStreamDestination();
    this._origSource.connect(this._destNode);

    if (!this._timer) {
      this._timer = setInterval(() => this._emitChirp(), CHIRP_INTERVAL_MS);
    }

    // The returned stream replaces audio tracks with the mixed one but keeps
    // any video tracks from the original.
    const out = new MediaStream();
    this._destNode.stream.getAudioTracks().forEach(t => out.addTrack(t));
    stream.getVideoTracks().forEach(t => out.addTrack(t));
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
  }
}

export class ChirpDetector {
  private _ctx: AudioContext;
  private _emit: (event: ProbeEvent) => void;
  private _activeDetectors = new Map<string, { stop: () => void }>();

  constructor(emit: (event: ProbeEvent) => void) {
    this._ctx = getAudioContext();
    this._emit = emit;
  }

  // Attach a Goertzel analyzer to a single remote audio stream.
  // sourceClientId is used to tag detection events.
  attach(sourceClientId: string, stream: MediaStream): void {
    if (this._activeDetectors.has(sourceClientId)) return;
    if (stream.getAudioTracks().length === 0) return;

    const ctx = this._ctx;
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = GOERTZEL_BLOCK * 2;
    src.connect(analyser);

    // Goertzel for CHIRP_HZ at sampleRate.
    const sampleRate = ctx.sampleRate;
    const k = Math.round((GOERTZEL_BLOCK * CHIRP_HZ) / sampleRate);
    const omega = (2 * Math.PI * k) / GOERTZEL_BLOCK;
    const coeff = 2 * Math.cos(omega);

    const buf = new Float32Array(GOERTZEL_BLOCK);
    let background = 0.001;
    let lastDetectMs = -Infinity;
    let timerId: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    // setInterval (not requestAnimationFrame) so the detector ticks at a fixed
    // rate even in headless / backgrounded tabs (Puppeteer bot listeners).
    // ~20 ms tick rate is faster than the chirp burst duration (50 ms) and the
    // refractory window (100 ms), so every chirp is sampled at least twice.
    const TICK_MS = 20;

    const tick = () => {
      if (stopped) return;
      analyser.getFloatTimeDomainData(buf);
      let s1 = 0;
      let s2 = 0;
      for (let i = 0; i < GOERTZEL_BLOCK; i++) {
        const s = buf[i] + coeff * s1 - s2;
        s2 = s1;
        s1 = s;
      }
      const mag = Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / GOERTZEL_BLOCK;
      // Rolling background tracker, slow update.
      background = 0.99 * background + 0.01 * mag;
      const now = performance.now();
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

    timerId = setInterval(tick, TICK_MS);

    const stop = () => {
      stopped = true;
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
      try {
        src.disconnect();
      } catch (e) {
        // ignore
      }
    };

    this._activeDetectors.set(sourceClientId, { stop });
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
