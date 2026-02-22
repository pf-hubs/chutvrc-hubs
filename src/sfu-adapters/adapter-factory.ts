import { SFU, SFU_CONNECTION_TYPE } from "../sfu-types";
import { SfuAdapter } from "./sfu-adapter";

// Import adapters
import { DialogAdapter } from "./dialog-adapter";
import { SoraAdapter } from "./sora-adapter";
import { LivekitAdapter } from "./livekit-adapter";

type AdapterConstructor = new (connectionType: SFU_CONNECTION_TYPE) => SfuAdapter;

/**
 * Factory for creating SFU adapter instances
 * Supports dynamic registration of new adapter types
 */
export class SfuAdapterFactory {
  private static readonly adapters: Map<SFU, AdapterConstructor> = new Map([
    [SFU.DIALOG, DialogAdapter as unknown as AdapterConstructor],
    [SFU.SORA, SoraAdapter as AdapterConstructor],
    [SFU.LIVEKIT, LivekitAdapter as AdapterConstructor]
  ]);

  /**
   * Create an SFU adapter instance
   * @param sfuType The type of SFU adapter to create
   * @param connectionType The connection type (sendrecv, send, recv)
   * @returns A new adapter instance
   * @throws Error if the SFU type is unknown
   */
  static create(sfuType: SFU, connectionType: SFU_CONNECTION_TYPE): SfuAdapter {
    const AdapterClass = this.adapters.get(sfuType);
    if (!AdapterClass) {
      throw new Error(`Unknown SFU type: ${SFU[sfuType]} (${sfuType})`);
    }
    return new AdapterClass(connectionType);
  }

  /**
   * Register a new adapter type
   * @param sfuType The SFU type identifier
   * @param adapterClass The adapter constructor
   */
  static register(sfuType: SFU, adapterClass: AdapterConstructor): void {
    this.adapters.set(sfuType, adapterClass);
  }

  /**
   * Check if an adapter type is registered
   * @param sfuType The SFU type to check
   * @returns true if the adapter is registered
   */
  static hasAdapter(sfuType: SFU): boolean {
    return this.adapters.has(sfuType);
  }

  /**
   * Get list of registered SFU types
   * @returns Array of registered SFU types
   */
  static getRegisteredTypes(): SFU[] {
    return Array.from(this.adapters.keys());
  }
}
