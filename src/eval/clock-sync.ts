import { ReportSink } from "./report-sink";
import { ClockPongMsg } from "./types";

// Runner-as-time-reference clock alignment.
// Multi-round WS ping-pong; pick the round with smallest RTT;
// compute offset_ms = t_server_ms - (t_client_send_ms + RTT/2).
// Re-validates periodically to detect drift over long runs.

type Round = {
  seq: number;
  t_send: number;
  t_recv: number;
  t_server: number;
};

export class ClockSync {
  private _sink: ReportSink;
  private _rounds = new Map<number, { t_send: number }>();
  private _completed: Round[] = [];
  private _nextSeq = 0;
  private _onSynced: (offset_ms: number, ci_ms: number) => void;
  private _onProgress?: () => void;
  private _initialRoundCount = 10;
  private _periodicRoundCount = 4;
  private _periodicIntervalMs = 30_000;
  private _periodicTimer: ReturnType<typeof setInterval> | null = null;
  private _initialDone = false;

  constructor(sink: ReportSink, onSynced: (offset_ms: number, ci_ms: number) => void) {
    this._sink = sink;
    this._onSynced = onSynced;
  }

  start() {
    this._completed = [];
    for (let i = 0; i < this._initialRoundCount; i++) {
      setTimeout(() => this._sendPing(), i * 100);
    }
  }

  // Call from probe-side WS message handler.
  handlePong(pong: ClockPongMsg) {
    const t_recv = performance.now();
    const rec = this._rounds.get(pong.seq);
    if (!rec) return;
    this._rounds.delete(pong.seq);
    this._completed.push({
      seq: pong.seq,
      t_send: rec.t_send,
      t_recv,
      t_server: pong.t_server_ms
    });
    this._maybeFinalize();
  }

  private _sendPing() {
    const seq = this._nextSeq++;
    const t_send = performance.now();
    this._rounds.set(seq, { t_send });
    this._sink.sendControl({ type: "clock-ping", seq, t_client_ms: t_send });
  }

  private _maybeFinalize() {
    if (!this._initialDone) {
      if (this._completed.length >= this._initialRoundCount) {
        this._compute(true);
      }
      return;
    }
    if (this._completed.length >= this._periodicRoundCount) {
      this._compute(false);
    }
  }

  private _compute(initial: boolean) {
    // Pick the round with smallest RTT for best accuracy.
    let best: Round | null = null;
    let bestRtt = Infinity;
    for (const r of this._completed) {
      const rtt = r.t_recv - r.t_send;
      if (rtt < bestRtt) {
        bestRtt = rtt;
        best = r;
      }
    }
    if (!best) return;
    const offset_ms = best.t_server - (best.t_send + bestRtt / 2);

    // CI estimate: half the spread of RTT/2 across all completed rounds.
    let minHalf = Infinity;
    let maxHalf = -Infinity;
    for (const r of this._completed) {
      const half = (r.t_recv - r.t_send) / 2;
      if (half < minHalf) minHalf = half;
      if (half > maxHalf) maxHalf = half;
    }
    const ci_ms = Math.max(1, (maxHalf - minHalf) / 2);

    this._completed = [];

    if (initial) {
      this._initialDone = true;
      this._periodicTimer = setInterval(() => {
        for (let i = 0; i < this._periodicRoundCount; i++) {
          setTimeout(() => this._sendPing(), i * 100);
        }
      }, this._periodicIntervalMs);
    }
    this._onSynced(offset_ms, ci_ms);
  }

  stop() {
    if (this._periodicTimer) {
      clearInterval(this._periodicTimer);
      this._periodicTimer = null;
    }
  }
}
