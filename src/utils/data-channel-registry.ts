/**
 * Data Channel Registry
 *
 * Centralized registry of all WebRTC data channels used in the application.
 * Defines channel reliability (lossy vs reliable), priority levels, and descriptions.
 *
 * Channel Naming Convention:
 * - # prefix indicates SFU data channel
 * - avatar-* channels are for real-time avatar transform sync
 * - System channels handle metadata and state
 */

/**
 * Data channel reliability mode
 * UNRELIABLE: UDP-like, lossy but fast (for real-time transforms)
 * RELIABLE: TCP-like, guaranteed delivery (for state changes)
 */
export enum DataChannelReliability {
  RELIABLE = "reliable",
  UNRELIABLE = "unreliable"
}

/**
 * Data channel priority levels
 * HIGH: Avatar transforms (15ms intervals)
 * MEDIUM: Animation state, VR mode (500ms intervals)
 * LOW: Metadata, system events (1000ms+ intervals)
 */
export enum DataChannelPriority {
  HIGH = 0,
  MEDIUM = 1,
  LOW = 2
}

/**
 * Adapter identifiers for channel support configuration
 */
export type AdapterId = "dialog" | "sora";

/**
 * Data channel definition
 */
export interface DataChannelDefinition {
  /** Channel label (e.g., "#avatar-RIG") */
  label: string;
  /** Reliability mode */
  reliability: DataChannelReliability;
  /** Priority level */
  priority: DataChannelPriority;
  /** Human-readable description */
  description: string;
  /** Typical send interval in milliseconds (0 = event-driven) */
  intervalMs?: number;
  /** Message format */
  format?: "binary" | "text" | "json";

  // ========== Handler & Routing Configuration ==========

  /** Whether this is a mandatory (avatar sync) or optional (feature) channel */
  isMandatory: boolean;
  /** Handler dispatch priority (lower = processed first) */
  handlerPriority: number;
  /** Which adapters support this channel */
  supportedAdapters: AdapterId[];
}

/**
 * Registry of all data channels used in the application
 */
export const DATA_CHANNEL_REGISTRY: Record<string, DataChannelDefinition> = {
  // ============= Avatar Transform Channels =============
  // These channels sync avatar body part transforms at high frequency.
  // Unreliable (lossy) is acceptable since transforms are sent continuously.

  "#avatar-RIG": {
    label: "#avatar-RIG",
    reliability: DataChannelReliability.UNRELIABLE,
    priority: DataChannelPriority.HIGH,
    description: "Avatar rig/root transform (position, rotation)",
    intervalMs: 15,
    format: "binary",
    isMandatory: true,
    handlerPriority: 0,
    supportedAdapters: ["dialog", "sora"]
  },

  "#avatar-HEAD": {
    label: "#avatar-HEAD",
    reliability: DataChannelReliability.UNRELIABLE,
    priority: DataChannelPriority.HIGH,
    description: "Avatar head transform for IK",
    intervalMs: 15,
    format: "binary",
    isMandatory: true,
    handlerPriority: 0,
    supportedAdapters: ["dialog", "sora"]
  },

  "#avatar-LEFT": {
    label: "#avatar-LEFT",
    reliability: DataChannelReliability.UNRELIABLE,
    priority: DataChannelPriority.HIGH,
    description: "Left hand/controller transform for IK",
    intervalMs: 15,
    format: "binary",
    isMandatory: true,
    handlerPriority: 0,
    supportedAdapters: ["dialog", "sora"]
  },

  "#avatar-RIGHT": {
    label: "#avatar-RIGHT",
    reliability: DataChannelReliability.UNRELIABLE,
    priority: DataChannelPriority.HIGH,
    description: "Right hand/controller transform for IK",
    intervalMs: 15,
    format: "binary",
    isMandatory: true,
    handlerPriority: 0,
    supportedAdapters: ["dialog", "sora"]
  },

  // ============= State Synchronization Channels =============
  // These channels sync avatar and client state changes.
  // Reliable delivery ensures state consistency across clients.

  "#avatarId": {
    label: "#avatarId",
    reliability: DataChannelReliability.RELIABLE,
    priority: DataChannelPriority.MEDIUM,
    description: "Avatar asset ID for loading avatar models",
    intervalMs: 0, // Event-driven (avatar change)
    format: "text",
    isMandatory: true,
    handlerPriority: 0,
    supportedAdapters: ["dialog", "sora"]
  },

  "#isVR": {
    label: "#isVR",
    reliability: DataChannelReliability.RELIABLE,
    priority: DataChannelPriority.MEDIUM,
    description: "VR/desktop mode flag for IK behavior",
    intervalMs: 1000,
    format: "text",
    isMandatory: true,
    handlerPriority: 0,
    supportedAdapters: ["dialog", "sora"]
  },

  "#avatarAnimState": {
    label: "#avatarAnimState",
    reliability: DataChannelReliability.RELIABLE,
    priority: DataChannelPriority.MEDIUM,
    description: "Avatar animation state (stand, walk, sit)",
    intervalMs: 500,
    format: "text",
    isMandatory: true,
    handlerPriority: 0,
    supportedAdapters: ["dialog", "sora"]
  },

  // ============= System/Feature Channels =============
  // Application-specific feature channels.

  "#nimpro": {
    label: "#nimpro",
    reliability: DataChannelReliability.RELIABLE,
    priority: DataChannelPriority.LOW,
    description: "Nimpro integration data",
    intervalMs: 0,
    format: "text",
    isMandatory: false,
    handlerPriority: 10,
    supportedAdapters: ["dialog", "sora"]
  },

  "#iot": {
    label: "#iot",
    reliability: DataChannelReliability.RELIABLE,
    priority: DataChannelPriority.LOW,
    description: "IoT device bridge communication",
    intervalMs: 0,
    format: "binary",
    isMandatory: false,
    handlerPriority: 100,
    supportedAdapters: ["dialog", "sora"]
  },

  "#pdfPage": {
    label: "#pdfPage",
    reliability: DataChannelReliability.RELIABLE,
    priority: DataChannelPriority.LOW,
    description: "PDF viewer page synchronization",
    intervalMs: 0,
    format: "text",
    isMandatory: false,
    handlerPriority: 20,
    supportedAdapters: ["dialog", "sora"]
  },

  "#laserPointer": {
    label: "#laserPointer",
    reliability: DataChannelReliability.UNRELIABLE,
    priority: DataChannelPriority.MEDIUM,
    description: "Laser pointer position for presentations",
    intervalMs: 50,
    format: "text",
    isMandatory: false,
    handlerPriority: 15,
    supportedAdapters: ["dialog", "sora"]
  },

  "#emoji": {
    label: "#emoji",
    reliability: DataChannelReliability.RELIABLE,
    priority: DataChannelPriority.LOW,
    description: "Emoji reactions",
    intervalMs: 0,
    format: "text",
    isMandatory: false,
    handlerPriority: 50,
    supportedAdapters: ["dialog", "sora"]
  },

  "#togglePublicSpeaker": {
    label: "#togglePublicSpeaker",
    reliability: DataChannelReliability.RELIABLE,
    priority: DataChannelPriority.LOW,
    description: "Public speaker mode toggle",
    intervalMs: 0,
    format: "text",
    isMandatory: false,
    handlerPriority: 20,
    supportedAdapters: ["dialog", "sora"]
  }
};

/**
 * Get all channel labels as an array
 */
export function getAllChannelLabels(): string[] {
  return Object.keys(DATA_CHANNEL_REGISTRY);
}

/**
 * Get channels by reliability type
 */
export function getChannelsByReliability(reliability: DataChannelReliability): DataChannelDefinition[] {
  return Object.values(DATA_CHANNEL_REGISTRY).filter((ch) => ch.reliability === reliability);
}

/**
 * Get channels by priority
 */
export function getChannelsByPriority(priority: DataChannelPriority): DataChannelDefinition[] {
  return Object.values(DATA_CHANNEL_REGISTRY).filter((ch) => ch.priority === priority);
}

/**
 * Get avatar transform channel labels
 */
export function getAvatarTransformChannels(): string[] {
  return Object.values(DATA_CHANNEL_REGISTRY)
    .filter((ch) => ch.label.startsWith("#avatar-"))
    .map((ch) => ch.label);
}

/**
 * Check if a channel is registered
 */
export function isChannelRegistered(label: string): boolean {
  return label in DATA_CHANNEL_REGISTRY;
}

/**
 * Get channel definition by label
 */
export function getChannelDefinition(label: string): DataChannelDefinition | undefined {
  return DATA_CHANNEL_REGISTRY[label];
}

// ============= Full Integration Functions =============

/**
 * Get all mandatory (avatar sync) channels
 */
export function getMandatoryChannels(): DataChannelDefinition[] {
  return Object.values(DATA_CHANNEL_REGISTRY).filter((ch) => ch.isMandatory);
}

/**
 * Get all optional (feature) channels
 */
export function getOptionalChannels(): DataChannelDefinition[] {
  return Object.values(DATA_CHANNEL_REGISTRY).filter((ch) => !ch.isMandatory);
}

/**
 * Get channels supported by a specific adapter
 */
export function getChannelsForAdapter(adapterId: AdapterId): DataChannelDefinition[] {
  return Object.values(DATA_CHANNEL_REGISTRY).filter((ch) => ch.supportedAdapters.includes(adapterId));
}

/**
 * Get mandatory channels for a specific adapter
 */
export function getMandatoryChannelsForAdapter(adapterId: AdapterId): DataChannelDefinition[] {
  return getMandatoryChannels().filter((ch) => ch.supportedAdapters.includes(adapterId));
}

/**
 * Get optional channels for a specific adapter
 */
export function getOptionalChannelsForAdapter(adapterId: AdapterId): DataChannelDefinition[] {
  return getOptionalChannels().filter((ch) => ch.supportedAdapters.includes(adapterId));
}

/**
 * Check if a channel is supported by an adapter
 */
export function isChannelSupportedByAdapter(label: string, adapterId: AdapterId): boolean {
  const def = getChannelDefinition(label);
  return def ? def.supportedAdapters.includes(adapterId) : false;
}

/**
 * Validate that a received message is on a registered channel for the adapter.
 * Returns true if valid, false if the channel is unknown or unsupported.
 */
export function validateChannelMessage(label: string, adapterId: AdapterId): boolean {
  // Avatar transform channels use pattern matching
  if (label.startsWith("#avatar-")) {
    return isChannelSupportedByAdapter(label, adapterId);
  }
  return isChannelSupportedByAdapter(label, adapterId);
}

/**
 * Get channel labels sorted by handler priority (lower = higher priority)
 */
export function getChannelLabelsSortedByPriority(): string[] {
  return Object.values(DATA_CHANNEL_REGISTRY)
    .sort((a, b) => a.handlerPriority - b.handlerPriority)
    .map((ch) => ch.label);
}
