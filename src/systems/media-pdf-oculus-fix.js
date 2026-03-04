/*
  PDFjs which is used to render pdfs depends on the window.requestAnimationFrame function.
  This is not called when in mobileVR.
  This system replaces the function with the requestAnimationFrame of the xrSession.
  It restores window.requestAnimationFrame when the user leaves xr.
*/
export class MediaPDFOculusFix {
  constructor(sceneEl) {
    // PC VR calls window.requestAnimationFrame even in VR mode
    if (AFRAME.utils.device.isMobileVR()) {
      this.requestAnimationFrameOriginal = window.requestAnimationFrame;
      this.cancelAnimationFrameOriginal = window.cancelAnimationFrame;
      sceneEl.addEventListener("enter-vr", () => {
        console.debug(`PDF: monkey-patching window.requestAnimationFrame:`, window.requestAnimationFrame);
        const { xrSession } = sceneEl;
        window.requestAnimationFrame = callback => {
          return xrSession?.requestAnimationFrame(callback);
        };
        window.cancelAnimationFrame = handle => {
          return xrSession?.cancelAnimationFrame(handle);
        };
      });
      sceneEl.addEventListener("exit-vr", () => {
        console.debug(`PDF: removing window.requestAnimationFrame monkey-patch`, this.requestAnimationFrameOriginal);
        window.requestAnimationFrame = this.requestAnimationFrameOriginal;
        window.cancelAnimationFrame = this.cancelAnimationFrameOriginal;
      });
    }
  }
}
