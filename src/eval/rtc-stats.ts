// Periodic RTCPeerConnection.getStats() collector.
//
// Walks the active SFU adapter's internal PeerConnections (adapter-specific
// access via known field names) and emits selected stats fields once per
// poll interval. All work is client-side; no server cooperation needed.

import { ProbeEvent } from "./types";

const POLL_MS = 1000;

// Stat fields we care about, filtered out of the full report to keep WS
// bandwidth reasonable.
const KEEP_TYPES = new Set([
  "inbound-rtp",
  "outbound-rtp",
  "remote-inbound-rtp",
  "remote-outbound-rtp",
  "candidate-pair",
  "transport"
]);
const KEEP_FIELDS = new Set([
  "id",
  "type",
  "kind",
  "mediaType",
  "ssrc",
  "timestamp",
  "bytesSent",
  "bytesReceived",
  "packetsSent",
  "packetsReceived",
  "packetsLost",
  "jitter",
  "framesPerSecond",
  "framesDecoded",
  "framesDropped",
  "currentRoundTripTime",
  "availableOutgoingBitrate",
  "availableIncomingBitrate",
  "nominated",
  "state"
]);

function filterReport(report: RTCStatsReport): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  report.forEach((stat: any, key: string) => {
    if (!KEEP_TYPES.has(stat.type)) return;
    const slim: Record<string, unknown> = {};
    for (const f of Object.keys(stat)) {
      if (KEEP_FIELDS.has(f)) slim[f] = stat[f];
    }
    out[key] = slim;
  });
  return out;
}

// Best-effort PC accessor per known adapter shape.
function extractPeerConnections(sfu: any): { kind: "send" | "recv" | "unknown"; pc: RTCPeerConnection }[] {
  const found: { kind: "send" | "recv" | "unknown"; pc: RTCPeerConnection }[] = [];
  if (!sfu) return found;

  // Dialog (mediasoup-client): _sendTransport._handler._pc, _recvTransport._handler._pc
  const tryDialog = (kind: "send" | "recv", t: any) => {
    if (!t) return;
    const pc = t?._handler?._pc || t?._pc;
    if (pc && typeof pc.getStats === "function") found.push({ kind, pc });
  };
  tryDialog("send", sfu._sendTransport);
  tryDialog("recv", sfu._recvTransport);

  // LiveKit (livekit-client): room.engine.client.publisher / subscriber
  const lk = sfu.room?.engine || sfu._room?.engine;
  if (lk) {
    const pub = lk.publisher?.pc || lk.pcManager?.publisher?.pc;
    const sub = lk.subscriber?.pc || lk.pcManager?.subscriber?.pc;
    if (pub) found.push({ kind: "send", pc: pub });
    if (sub) found.push({ kind: "recv", pc: sub });
  }

  // Sora: connection?._pc
  const sora = sfu._connection;
  if (sora && sora._pc && typeof sora._pc.getStats === "function") {
    found.push({ kind: "unknown", pc: sora._pc });
  }

  // De-dup by PC identity.
  const seen = new WeakSet<RTCPeerConnection>();
  return found.filter(entry => {
    if (seen.has(entry.pc)) return false;
    seen.add(entry.pc);
    return true;
  });
}

export class RtcStatsCollector {
  private _getSfu: () => any;
  private _emit: (event: ProbeEvent) => void;
  private _timer: ReturnType<typeof setInterval> | null = null;

  constructor(getSfu: () => any, emit: (event: ProbeEvent) => void) {
    this._getSfu = getSfu;
    this._emit = emit;
  }

  start() {
    this._timer = setInterval(() => this._collect(), POLL_MS);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private async _collect() {
    const sfu = this._getSfu();
    const pcs = extractPeerConnections(sfu);
    for (const { kind, pc } of pcs) {
      try {
        const report = await pc.getStats();
        const slim = filterReport(report);
        this._emit({
          kind: "rtc-stats",
          t_client_ms: performance.now(),
          peer_kind: kind,
          report: slim
        });
      } catch (e) {
        // ignore; pc may have been closed mid-poll
      }
    }
  }
}
