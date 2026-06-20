export const EVAL_PROTOCOL_VERSION = 1;

export type ProbeMode = "speaker" | "passive";

export type AvatarSendEvent = {
  kind: "avatar-send";
  t_client_ms: number;
  channel: string;
  seq: number;
};

export type AvatarRecvEvent = {
  kind: "avatar-recv";
  t_client_ms: number;
  channel: string;
  source_client_id: string;
  seq: number;
};

export type ChirpEmitEvent = {
  kind: "chirp-emit";
  t_client_ms: number;
  seq: number;
};

export type ChirpDetectEvent = {
  kind: "chirp-detect";
  t_client_ms: number;
  source_client_id: string | null;
  magnitude: number;
};

export type RtcStatsEvent = {
  kind: "rtc-stats";
  t_client_ms: number;
  peer_kind: "send" | "recv" | "unknown";
  report: Record<string, unknown>;
};

export type PeerJoinEvent = {
  kind: "peer-join";
  t_client_ms: number;
  peer_client_id: string;
};

export type PeerLeaveEvent = {
  kind: "peer-leave";
  t_client_ms: number;
  peer_client_id: string;
};

export type HeadSlateEmitEvent = {
  kind: "head-slate-emit";
  t_client_ms: number;
  chirp_seq: number;
  head_send_seq: number;
};

export type ProbeEvent =
  | AvatarSendEvent
  | AvatarRecvEvent
  | ChirpEmitEvent
  | ChirpDetectEvent
  | HeadSlateEmitEvent
  | RtcStatsEvent
  | PeerJoinEvent
  | PeerLeaveEvent;

export type HelloMsg = {
  type: "hello";
  protocol: number;
  label: string;
  mode: ProbeMode;
  client_id: string | null;
  user_agent: string;
  hub_id: string | null;
  sfu_kind: string | null;
  sample_rate: number;
};

export type ClockPingMsg = {
  type: "clock-ping";
  seq: number;
  t_client_ms: number;
};

export type EventBatchMsg = {
  type: "event-batch";
  events: ProbeEvent[];
};

export type ByeMsg = { type: "bye" };

export type ClockOffsetMsg = {
  type: "clock-offset";
  at_t_client_ms: number;
  offset_ms: number;
  ci_ms: number;
};

export type ProbeToRunnerMsg = HelloMsg | ClockPingMsg | EventBatchMsg | ByeMsg | ClockOffsetMsg;

export type AckHelloMsg = {
  type: "ack-hello";
  run_id: string;
  warnings: string[];
};

export type ClockPongMsg = {
  type: "clock-pong";
  seq: number;
  t_client_ms: number;
  t_server_ms: number;
};

export type WarningMsg = {
  type: "warning";
  reason: string;
};

export type StopMsg = { type: "stop" };

export type RunnerToProbeMsg = AckHelloMsg | ClockPongMsg | WarningMsg | StopMsg;
