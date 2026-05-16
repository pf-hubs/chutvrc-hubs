// Eval probe entry. Loaded lazily via `import()` only when `?eval=1`.
//
// Wires:
//   - EvalHooks ← avatar-sync-helper send/recv/peer-leave call sites
//   - SfuPatcher → audio chirp inject/detect on APP.sfu
//   - RtcStatsCollector → periodic pc.getStats()
//   - ClockSync → runner-as-time-reference RTT loop
//   - ReportSink → batched WS to runner

import qsTruthy, { qsGet } from "../utils/qs_truthy";
import { EvalHooks } from "./eval-hooks";
import { ReportSink } from "./report-sink";
import { ClockSync } from "./clock-sync";
import { SfuPatcher } from "./sfu-patcher";
import { RtcStatsCollector } from "./rtc-stats";
import { SendSeq, RecvSeq } from "./event-pairing";
import {
  EVAL_PROTOCOL_VERSION,
  HelloMsg,
  ProbeEvent,
  ProbeMode,
  RunnerToProbeMsg
} from "./types";

const SFU_KIND_NAMES: Record<number, string> = {
  0: "dialog",
  1: "sora",
  2: "livekit",
  3: "cloudflare"
};

function getQs(name: string): string | null {
  return qsGet(name);
}

function parseMode(): ProbeMode {
  const raw = getQs("mode");
  if (raw === "speaker") return "speaker";
  return "passive";
}

function parseSampleRate(): number {
  const raw = getQs("sample");
  if (!raw) return 1;
  const n = Number(raw);
  if (!isFinite(n) || n <= 0 || n > 1) return 1;
  return n;
}

function defaultReportUrl(): string {
  const explicit = getQs("report");
  if (explicit) return explicit;
  // Fall back to wss on same host, port 9099.
  const host = location.hostname;
  return "wss://" + host + ":9099";
}

function getHubId(): string | null {
  const app: any = (window as any).APP;
  return app?.hub?.hub_id || app?.hubChannel?.hubId || getQs("hub_id") || null;
}

export function installProbe(app: any) {
  if (!qsTruthy("eval")) return;

  const mode = parseMode();
  const label = getQs("label") || "anonymous";
  const reportUrl = defaultReportUrl();
  const sampleRate = parseSampleRate();

  console.log("[eval] probe enabled mode=" + mode + " label=" + label + " report=" + reportUrl);

  let clockReady = false;
  let clockOffsetMs = 0;
  let clockCiMs = 0;
  const preSyncBuffer: ProbeEvent[] = [];

  let sink: ReportSink;

  const emit = (event: ProbeEvent) => {
    if (!clockReady) {
      preSyncBuffer.push(event);
      if (preSyncBuffer.length > 50_000) preSyncBuffer.shift();
      return;
    }
    sink.enqueueEvent(event);
  };

  const sendSeq = new SendSeq();
  const recvSeq = new RecvSeq();

  EvalHooks.onAvatarSend = (channel, _buf) => {
    const seq = sendSeq.next(channel);
    emit({
      kind: "avatar-send",
      t_client_ms: performance.now(),
      channel,
      seq
    });
  };

  EvalHooks.onAvatarRecv = (channel, _buf, sourceClientId) => {
    // Receive-side sampling: keep every Kth event when sampleRate < 1.
    if (sampleRate < 1 && Math.random() > sampleRate) return;
    const seq = recvSeq.next(sourceClientId, channel);
    emit({
      kind: "avatar-recv",
      t_client_ms: performance.now(),
      channel,
      source_client_id: sourceClientId,
      seq
    });
  };

  EvalHooks.onPeerLeave = clientId => {
    emit({
      kind: "peer-leave",
      t_client_ms: performance.now(),
      peer_client_id: clientId
    });
    recvSeq.reset(clientId);
    patcher.detachPeer(clientId);
  };

  const handleMessage = (msg: RunnerToProbeMsg) => {
    switch (msg.type) {
      case "clock-pong":
        clockSync.handlePong(msg);
        break;
      case "ack-hello":
        for (const w of msg.warnings || []) console.warn("[eval] runner warning:", w);
        break;
      case "warning":
        console.warn("[eval] runner warning:", msg.reason);
        break;
      case "stop":
        console.log("[eval] runner requested stop");
        sink.stop();
        break;
    }
  };

  sink = new ReportSink(reportUrl, handleMessage);

  const clockSync = new ClockSync(sink, (offsetMs, ciMs) => {
    clockOffsetMs = offsetMs;
    clockCiMs = ciMs;
    // Ship the offset to the runner so the aggregator can convert
    // each event's t_client_ms → t_server_ms.
    sink.sendControl({
      type: "clock-offset",
      at_t_client_ms: performance.now(),
      offset_ms: offsetMs,
      ci_ms: ciMs
    });
    if (!clockReady) {
      clockReady = true;
      console.log("[eval] clock synced offset=" + offsetMs.toFixed(2) + "ms ±" + ciMs.toFixed(2) + "ms");
      while (preSyncBuffer.length > 0) {
        const e = preSyncBuffer.shift();
        if (e) sink.enqueueEvent(e);
      }
    } else {
      console.log("[eval] clock re-validated offset=" + offsetMs.toFixed(2) + "ms ±" + ciMs.toFixed(2) + "ms");
    }
  });

  const patcher = new SfuPatcher(app, mode, emit);
  const rtcStats = new RtcStatsCollector(() => app?.sfu, emit);

  // Lifecycle: wait for APP.sfu to materialize before sending hello.
  const sendHelloWhenReady = () => {
    const sfu = app?.sfu;
    if (!sfu || !sfu._clientId) {
      setTimeout(sendHelloWhenReady, 500);
      return;
    }
    const hello: HelloMsg = {
      type: "hello",
      protocol: EVAL_PROTOCOL_VERSION,
      label,
      mode,
      client_id: sfu._clientId,
      user_agent: navigator.userAgent,
      hub_id: getHubId(),
      sfu_kind: SFU_KIND_NAMES[sfu._sfuId] || "unknown",
      sample_rate: sampleRate
    };
    sink.sendControl(hello);
    clockSync.start();
    patcher.start();
    rtcStats.start();
  };

  sink.start();
  sendHelloWhenReady();

  window.addEventListener("beforeunload", () => {
    clockSync.stop();
    patcher.stop();
    rtcStats.stop();
    sink.stop();
  });

  // Expose for debugging.
  (window as any).__eval = {
    clockOffsetMs: () => clockOffsetMs,
    clockCiMs: () => clockCiMs,
    sink,
    patcher,
    rtcStats
  };
}
