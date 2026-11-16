import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry, sRGBEncoding } from "three";
import { createIntl, createIntlCache, IntlShape, MessageDescriptor } from "react-intl";
import { getLocale, getMessages } from "../../utils/i18n";

/**
 * A rounded panel with one line of text, for what the body calibration shows in VR: the capture prompt
 * (vr-capture.ts) and the "capture again" button in the in-world menu (components/body-capture-button.js).
 * The text is drawn onto a canvas with the browser's fonts rather than with the scene's text component,
 * whose default font has no Japanese glyphs.
 */

export type TextPanelSize = {
  /** The panel's size in metres */
  width: number;
  height: number;
  /** Its texture's size in pixels, at the same proportions */
  canvasWidth: number;
  canvasHeight: number;
  /** The text's size in pixels, made smaller when the line would not fit */
  fontSize: number;
  /** The room kept free at either end of the line, in pixels */
  textMargin: number;
};

export class TextPanel {
  readonly mesh: Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly texture: CanvasTexture;
  private text = "";
  private background = "";

  constructor(private readonly size: TextPanelSize) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = size.canvasWidth;
    this.canvas.height = size.canvasHeight;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.encoding = sRGBEncoding;
    const material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      side: DoubleSide
    });
    this.mesh = new Mesh(new PlaneGeometry(size.width, size.height), material);
    // Drawn over the room, so a wall or an avatar close by does not hide it
    this.mesh.renderOrder = 10000;
  }

  /** Draws the line of text, white on the given background colour; nothing is redrawn when neither changed */
  draw(text: string, background: string) {
    if (text === this.text && background === this.background) return;
    const context = this.canvas.getContext("2d");
    if (!context) return;
    this.text = text;
    this.background = background;
    const { canvasWidth, canvasHeight, textMargin } = this.size;
    context.clearRect(0, 0, canvasWidth, canvasHeight);
    context.fillStyle = background;
    const radius = canvasHeight / 4;
    context.beginPath();
    context.moveTo(radius, 0);
    context.arcTo(canvasWidth, 0, canvasWidth, canvasHeight, radius);
    context.arcTo(canvasWidth, canvasHeight, 0, canvasHeight, radius);
    context.arcTo(0, canvasHeight, 0, 0, radius);
    context.arcTo(0, 0, canvasWidth, 0, radius);
    context.closePath();
    context.fill();
    // One line, made smaller when it would not fit
    let fontSize = this.size.fontSize;
    context.font = `bold ${fontSize}px sans-serif`;
    const width = context.measureText(text).width;
    const room = canvasWidth - 2 * textMargin;
    if (width > room) {
      fontSize = Math.floor((fontSize * room) / width);
      context.font = `bold ${fontSize}px sans-serif`;
    }
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, canvasWidth / 2, canvasHeight / 2);
    this.texture.needsUpdate = true;
  }
}

let intl: IntlShape | null = null;
let intlLocale = "";
const intlCache = createIntlCache();

/** A message in the language the page shows, the English one while it shows English */
export function formatCalibrationMessage(message: MessageDescriptor): string {
  const locale = getLocale();
  if (!intl || intlLocale !== locale) {
    intl = createIntl({ locale, messages: getMessages(), onError: () => {} }, intlCache);
    intlLocale = locale;
  }
  return intl.formatMessage(message);
}
