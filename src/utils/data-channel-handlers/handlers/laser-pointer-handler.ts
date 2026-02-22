import { ChannelHandlerContext, IChannelHandler } from "../channel-handler-interface";
import { Object3D, SphereGeometry, MeshBasicMaterial, Mesh } from "three";
import { SFU_CONNECTION_TYPE } from "../../../sfu-types";

/**
 * Handler for #laserPointer channel.
 * Handles laser pointer position synchronization for presentations.
 *
 * Message format: "visible|x|y|z"
 * - visible: "1" for visible, "0" for hidden
 * - x, y, z: Position coordinates
 *
 * Supported by: SoraAdapter only
 * Note: Only processes messages when NOT in RECV-only mode.
 */
export class LaserPointerHandler implements IChannelHandler {
  readonly channelLabel = "#laserPointer";
  readonly isMandatory = false;
  readonly priority = 15;

  private laserPointer: Object3D | null = null;

  handleMessage(data: Uint8Array, context: ChannelHandlerContext): void {
    // Only process if not in receive-only mode
    if (context.adapter._connectionType === SFU_CONNECTION_TYPE.RECV) {
      return;
    }

    const message = context.textDecoder.decode(data);
    const parts = message.split("|");

    if (!parts || parts.length < 4) {
      return;
    }

    // Create laser pointer mesh if not exists
    if (!this.laserPointer) {
      this.createLaserPointer();
    }

    if (this.laserPointer) {
      // Update visibility
      this.laserPointer.visible = parts[0] === "1";

      // Update position if valid coordinates
      const x = parseFloat(parts[1]);
      const y = parseFloat(parts[2]);
      const z = parseFloat(parts[3]);

      if (x !== 0 || y !== 0 || z !== 0) {
        this.laserPointer.position.set(x, y, z);
        this.laserPointer.updateMatrix();
      }
    }
  }

  /**
   * Create the laser pointer 3D object.
   */
  private createLaserPointer(): void {
    const geometry = new SphereGeometry(0.2);
    const material = new MeshBasicMaterial({
      color: "#ff0000",
      transparent: true,
      opacity: 0.7
    });

    this.laserPointer = new Mesh(geometry, material);

    // Add to scene
    if (typeof APP !== "undefined" && APP.world?.scene) {
      APP.world.scene.add(this.laserPointer);
    }
  }

  /**
   * Cleanup laser pointer on disconnect.
   */
  onDisconnect(context: ChannelHandlerContext): void {
    if (this.laserPointer) {
      if (typeof APP !== "undefined" && APP.world?.scene) {
        APP.world.scene.remove(this.laserPointer);
      }
      this.laserPointer = null;
    }
  }

  /**
   * Hide laser pointer when client leaves.
   * Called externally when a public speaker disconnects.
   */
  hideLaserPointer(): void {
    if (this.laserPointer) {
      this.laserPointer.visible = false;
    }
  }
}
