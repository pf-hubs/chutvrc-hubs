// Singleton callback registry for the eval probe.
// When the probe is not loaded (default), the callbacks are undefined and the
// inline call sites (`EvalHooks.onAvatarSend?.(...)`) are no-ops.
//
// The probe assigns these on install. Keeping this in its own module means the
// avatar-sync-helper hot path imports a tiny singleton, not the heavy probe.

export type AvatarHook = (channel: string, buf: Uint8Array) => void;
export type AvatarRecvHook = (channel: string, buf: Uint8Array, sourceClientId: string) => void;
export type PeerLeaveHook = (clientId: string) => void;

export const EvalHooks: {
  onAvatarSend?: AvatarHook;
  onAvatarRecv?: AvatarRecvHook;
  onPeerLeave?: PeerLeaveHook;
} = {};
