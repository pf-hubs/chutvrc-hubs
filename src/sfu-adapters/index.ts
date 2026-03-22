// Adapter interfaces
export * from "../types/sfu-adapter-interface";

// Base adapter class
export { SfuAdapter, SFU_CONNECTION_CONNECTED, SFU_CONNECTION_ERROR_FATAL } from "./sfu-adapter";
export type { DataChannelMessage } from "./sfu-adapter";

// Adapter implementations
export { DialogAdapter } from "./dialog-adapter";
export { SoraAdapter } from "./sora-adapter";

// Adapter factory
export { SfuAdapterFactory } from "./adapter-factory";

// Adapter utilities
export { connectSfu } from "../utils/sfu-adapter-utils";
