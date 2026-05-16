import { ProbeEvent, ProbeToRunnerMsg, RunnerToProbeMsg } from "./types";

// Batched WebSocket sender. Buffers events while disconnected and during
// clock-sync, then ships them as `event-batch` frames.

export type MessageHandler = (msg: RunnerToProbeMsg) => void;

export class ReportSink {
  private _ws: WebSocket | null = null;
  private _url: string;
  private _queue: ProbeEvent[] = [];
  private _backlog: ProbeToRunnerMsg[] = [];
  private _onMessage: MessageHandler;
  private _flushTimer: ReturnType<typeof setInterval> | null = null;
  private _open = false;
  private _flushMs = 50;
  private _maxBatch = 500;
  private _closed = false;

  constructor(url: string, onMessage: MessageHandler) {
    this._url = url;
    this._onMessage = onMessage;
  }

  start() {
    this._connect();
    this._flushTimer = setInterval(() => this._flush(), this._flushMs);
  }

  stop() {
    this._closed = true;
    this._flush();
    if (this._flushTimer) {
      clearInterval(this._flushTimer);
      this._flushTimer = null;
    }
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      try {
        this._ws.send(JSON.stringify({ type: "bye" }));
      } catch (e) {
        // ignore
      }
      this._ws.close();
    }
  }

  // Send a control message (hello, clock-ping) immediately rather than batching.
  sendControl(msg: ProbeToRunnerMsg) {
    if (this._open && this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    } else {
      this._backlog.push(msg);
    }
  }

  enqueueEvent(event: ProbeEvent) {
    this._queue.push(event);
    if (this._queue.length >= this._maxBatch) {
      this._flush();
    }
  }

  private _connect() {
    if (this._closed) return;
    try {
      this._ws = new WebSocket(this._url);
    } catch (e) {
      console.error("[eval] WS construct failed:", e);
      setTimeout(() => this._connect(), 2000);
      return;
    }
    this._ws.onopen = () => {
      this._open = true;
      // Drain backlog of control messages (hello, etc.) that queued while disconnected.
      while (this._backlog.length > 0) {
        const m = this._backlog.shift();
        if (m) this._ws!.send(JSON.stringify(m));
      }
    };
    this._ws.onmessage = ev => {
      try {
        const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        this._onMessage(msg);
      } catch (e) {
        // ignore parse errors
      }
    };
    this._ws.onclose = () => {
      this._open = false;
      this._ws = null;
      if (!this._closed) setTimeout(() => this._connect(), 2000);
    };
    this._ws.onerror = () => {
      // onclose will fire after error; the reconnect happens there.
    };
  }

  private _flush() {
    if (this._queue.length === 0) return;
    if (!this._open || !this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    const batch = this._queue.splice(0, this._maxBatch);
    const msg: ProbeToRunnerMsg = { type: "event-batch", events: batch };
    try {
      this._ws.send(JSON.stringify(msg));
    } catch (e) {
      // Re-queue at front on failure.
      this._queue = batch.concat(this._queue);
    }
  }
}
