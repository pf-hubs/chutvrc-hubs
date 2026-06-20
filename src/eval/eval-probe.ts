// Eval probe entry. Loaded lazily via `import()` only when `?eval=1`.
//
// Wires:
//   - EvalHooks ← avatar-sync-helper send/recv/peer-leave call sites
//   - SfuPatcher → audio chirp inject/detect on APP.sfu
//   - RtcStatsCollector → periodic pc.getStats()
//   - ClockSync → runner-as-time-reference RTT loop
//   - ReportSink → batched WS to runner

import { Object3D } from "three";
import qsTruthy, { qsGet } from "../utils/qs_truthy";
import { encodeAvatarTransform } from "../utils/avatar-utils";
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

  // Speaker-only: at each audio chirp, broadcast ONE discrete #avatar-HEAD "slate"
  // packet coincident with the chirp. The runner pairs it with the chirp detection at
  // each listener to measure audio↔avatar arrival skew against a shared sender instant
  // (replaces the old free-running #avatar-RIG staleness offset). The bot's head is
  // otherwise static, so every #avatar-HEAD packet is unambiguously one slate.
  // Fixed head-height local position (matches #avatar-pov-node's rig-local pose); only the
  // rotation changes per slate. The pos/rot values are cosmetic: the packet is broadcast
  // unconditionally (we bypass the native "transform changed?" gate), and the listener logs
  // an avatar-recv for every received HEAD packet regardless of contents — so position never
  // needs to change. Exactly one HEAD packet per chirp because the real pump never sends HEAD
  // (the bot's actual head object3D stays static).
  const headSlateObj = new Object3D();
  headSlateObj.position.set(0, 1.6, 0);
  let headSlateYawSign = 1;
  const sendHeadSlate = (chirpSeq: number) => {
    const sfu = app?.sfu;
    if (!sfu || typeof sfu.broadcastUint8 !== "function" || !sfu._clientId) return;
    // Small alternating yaw so the rendered head visibly nods (set absolutely, so it never
    // drifts). Reuse the real wire encoder so the bytes are byte-identical to a genuine pose
    // packet. Encode the clientId at send time — it isn't assigned until the SFU is ready.
    headSlateYawSign = -headSlateYawSign;
    headSlateObj.rotation.set(0, 0.2 * headSlateYawSign, 0);
    const bytes = encodeAvatarTransform(headSlateObj, new TextEncoder().encode(sfu._clientId));
    try {
      sfu.broadcastUint8("#avatar-HEAD", bytes);
    } catch (e) {
      console.warn("[eval] head-slate broadcast failed:", e);
      return;
    }
    // Allocate the send seq only after a successful broadcast, so a thrown send never
    // desyncs the sender HEAD send-seq from listeners' recv-seq (the aggregator's
    // exact-seq HEAD join depends on 1:1 alignment).
    const seq = sendSeq.next("#avatar-HEAD");
    const now = performance.now();
    emit({ kind: "avatar-send", t_client_ms: now, channel: "#avatar-HEAD", seq });
    emit({ kind: "head-slate-emit", t_client_ms: now, chirp_seq: chirpSeq, head_send_seq: seq });
    console.log("[eval] head-slate chirp_seq=" + chirpSeq + " head_seq=" + seq);
  };

  const patcher = new SfuPatcher(app, mode, emit, mode === "speaker" ? sendHeadSlate : undefined);
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
