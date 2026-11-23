/**
 * Errors thrown by the work of a frame, caught by the frame function (mainTick in systems/hubs-systems.ts).
 *
 * The renderer asks for the next frame only after the frame function has returned, so one uncaught error
 * inside a frame ends the frame loop for good: on a screen the picture freezes, in a headset it goes
 * black, and the client stops sending its pose. Catching the error costs the part of the frame that threw,
 * not the session. Nothing is hidden by it: every distinct error is logged in full a few times and then
 * only counted, and `APP.frameErrors.count` lets a test fail on any.
 */

/** How often one distinct error is logged in full before it is only counted */
const MAX_LOGGED_PER_ERROR = 3;

const timesSeen = new Map<string, number>();

export const frameErrors: { count: number; last: unknown } = { count: 0, last: null };

/** Records an error caught in the named part of a frame */
export function reportFrameError(part: string, error: unknown) {
  frameErrors.count++;
  frameErrors.last = error;
  const key = `${part}: ${error instanceof Error ? error.message : String(error)}`;
  const seen = timesSeen.get(key) || 0;
  timesSeen.set(key, seen + 1);
  if (seen < MAX_LOGGED_PER_ERROR) {
    console.error(`Error in a frame (${part}); the frame goes on:`, error);
  } else if (seen === MAX_LOGGED_PER_ERROR) {
    console.error(`Error in a frame (${part}) keeps occurring; from now on it is only counted: ${key}`);
  }
}
