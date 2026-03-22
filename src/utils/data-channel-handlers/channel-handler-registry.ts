import { IChannelHandler } from "./channel-handler-interface";

/**
 * Registry for data channel handlers.
 * Manages handler registration, lookup, and categorization.
 */
export class ChannelHandlerRegistry {
  private handlers: Map<string, IChannelHandler> = new Map();
  private sortedHandlersCache: IChannelHandler[] | null = null;

  /**
   * Register a handler for a channel.
   * @param handler The handler to register
   * @throws Error if a handler is already registered for the channel
   */
  register(handler: IChannelHandler): void {
    if (this.handlers.has(handler.channelLabel)) {
      throw new Error(`Handler already registered for channel: ${handler.channelLabel}`);
    }
    this.handlers.set(handler.channelLabel, handler);
    this.sortedHandlersCache = null; // Invalidate cache
  }

  /**
   * Unregister a handler for a channel.
   * @param channelLabel The channel label to unregister
   */
  unregister(channelLabel: string): void {
    this.handlers.delete(channelLabel);
    this.sortedHandlersCache = null; // Invalidate cache
  }

  /**
   * Get the handler for a specific channel.
   * @param channelLabel The channel label to look up
   * @returns The handler or undefined if not found
   */
  getHandler(channelLabel: string): IChannelHandler | undefined {
    return this.handlers.get(channelLabel);
  }

  /**
   * Check if a handler is registered for a channel.
   * @param channelLabel The channel label to check
   */
  hasHandler(channelLabel: string): boolean {
    return this.handlers.has(channelLabel);
  }

  /**
   * Get all mandatory (avatar sync) handlers.
   */
  getMandatoryHandlers(): IChannelHandler[] {
    return Array.from(this.handlers.values()).filter(h => h.isMandatory);
  }

  /**
   * Get all optional (feature) handlers.
   */
  getOptionalHandlers(): IChannelHandler[] {
    return Array.from(this.handlers.values()).filter(h => !h.isMandatory);
  }

  /**
   * Get all handlers sorted by priority (lower priority value = processed first).
   */
  getAllHandlersSorted(): IChannelHandler[] {
    if (this.sortedHandlersCache === null) {
      this.sortedHandlersCache = Array.from(this.handlers.values()).sort((a, b) => a.priority - b.priority);
    }
    return this.sortedHandlersCache;
  }

  /**
   * Get all registered channel labels.
   */
  getRegisteredChannels(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Clear all registered handlers.
   */
  clear(): void {
    this.handlers.clear();
    this.sortedHandlersCache = null;
  }

  /**
   * Get the number of registered handlers.
   */
  get size(): number {
    return this.handlers.size;
  }
}

/**
 * Global singleton registry instance.
 * Use this for application-wide handler registration.
 */
export const globalChannelHandlerRegistry = new ChannelHandlerRegistry();
