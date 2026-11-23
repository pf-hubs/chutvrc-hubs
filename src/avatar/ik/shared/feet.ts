import { Quaternion, Vector3 } from "three";

/**
 * Where an avatar's feet stand and how they step. A foot stays planted on the floor while the body moves
 * over it, and steps to its place under the hips once that has moved away: lifted, over a short time, one
 * foot at a time. Turning the body makes the feet step round as well.
 *
 * The feet are planted on the floor, not in the rig: their places are kept in floor space, which has the
 * room's axes and the model's metres (the rig's position divided by the size the model is drawn at). So it
 * makes no difference whether the body moved because the headset moved in the rig or because the rig
 * itself moved with the stick or the keyboard, and one piece of code gives steps for both, for the own
 * avatar and for everyone else's. It needs nothing but the pose every client already has, so nothing about
 * the feet is sent. Pure: no scene access, nothing allocated per frame.
 */

export type FootSide = "left" | "right";
const SIDES: readonly FootSide[] = ["left", "right"];

/** How far the place under the hips may move from a planted foot before the foot steps to it, in model metres */
export const STEP_DISTANCE = 0.25;
/** How far the body may turn from a planted foot before the foot steps round, in radians */
export const STEP_YAW = (40 * Math.PI) / 180;
/** A step takes this long at most, and at least; in between, long enough to cover STRIDE_REACH at the body's speed */
export const MAX_STEP_SECONDS = 0.32;
export const MIN_STEP_SECONDS = 0.16;
export const STRIDE_REACH = 0.5;
/** A foot lands ahead of its place by the body's speed times this share of a step's time, so the body passes over it */
const LEAD_SHARE = 0.5;
/** A foot is lifted by this share of its step's length, within these limits, in model metres */
const LIFT_SHARE = 0.3;
const MIN_LIFT = 0.03;
const MAX_LIFT = 0.1;
/** A foot this far from its place steps even while the other foot is in the air */
const FORCE_DISTANCE = 0.55;
/** A planted foot is never left further than this from its place: beyond it, it is dragged along */
const MAX_REACH = 0.7;
/** A body that moved this far in one frame was moved at once (a teleport, a waypoint): the feet go with it without a step */
export const TELEPORT_DISTANCE = 1;
/** The body's speed is smoothed over about this long, in seconds */
const SPEED_TIME_CONSTANT = 0.1;
/** Once the body has been slower than this for this long, feet left apart by the last steps are brought to their places */
const IDLE_SPEED = 0.15;
const SETTLE_AFTER_SECONDS = 0.3;
const SETTLE_DISTANCE = 0.05;

/** A sitting avatar's feet: this far in front of the hips and this high over the floor */
export const SITTING_FOOT_FORWARD = 0.4;
export const SITTING_FOOT_HEIGHT = 0.3;

/** One foot, kept from frame to frame */
export type FootPlacement = {
  /** Where the foot is this frame, in root space, and which way it points there (a yaw; zero faces -z) */
  position: Vector3;
  yaw: number;
  /** Whether the foot has a place on the floor; a foot that has none takes one at its next standing frame */
  planted: boolean;
  /** Where the foot is on the floor, in floor space, and which way it points there */
  floor: Vector3;
  floorYaw: number;
  /** A step under way: where it began, how long it has taken of how long it takes, and how high it lifts */
  stepping: boolean;
  from: Vector3;
  fromYaw: number;
  elapsed: number;
  duration: number;
  lift: number;
};

/** Both feet of one avatar and what its steps are timed by */
export type Gait = {
  feet: Record<FootSide, FootPlacement>;
  /** The hips' place on the floor at the previous frame, and whether there was one */
  hips: Vector3;
  hasHips: boolean;
  /** The body's smoothed speed over the floor, in model metres a second */
  velocity: Vector3;
  /** How long the body has been standing still, in seconds */
  idleSeconds: number;
};

/** The rig on the floor: its position in model metres and its heading, which take root space to floor space */
export type FloorFrame = { x: number; z: number; yaw: number };

function createFootPlacement(): FootPlacement {
  return {
    position: new Vector3(),
    yaw: 0,
    planted: false,
    floor: new Vector3(),
    floorYaw: 0,
    stepping: false,
    from: new Vector3(),
    fromYaw: 0,
    elapsed: 0,
    duration: MAX_STEP_SECONDS,
    lift: 0
  };
}

export function createGait(): Gait {
  return {
    feet: { left: createFootPlacement(), right: createFootPlacement() },
    hips: new Vector3(),
    hasHips: false,
    velocity: new Vector3(),
    idleSeconds: 0
  };
}

/** Takes the feet off the floor: the next standing frame plants them afresh where the body stands */
export function resetGait(gait: Gait) {
  for (const side of SIDES) {
    const foot = gait.feet[side];
    foot.position.set(0, 0, 0);
    foot.yaw = 0;
    foot.planted = false;
    foot.stepping = false;
  }
  gait.hasHips = false;
  gait.velocity.set(0, 0, 0);
  gait.idleSeconds = 0;
}

/**
 * Where the foot would stand now: its rest offset from the hips turned with the body, under the hips, at
 * the height the rest pose stands at. The hips' height does not matter, so a crouch keeps the feet down.
 */
export function standingFootTarget(
  hips: Vector3,
  bodyDelta: Quaternion,
  restOffsetFromHips: Vector3,
  restFootHeight: number,
  out: Vector3
): Vector3 {
  out.copy(restOffsetFromHips).applyQuaternion(bodyDelta);
  out.x += hips.x;
  out.z += hips.z;
  out.y = restFootHeight;
  return out;
}

/** Where the foot goes while sitting: the standing spot moved forward and raised */
export function sittingFootTarget(
  hips: Vector3,
  bodyDelta: Quaternion,
  forward: Vector3,
  restOffsetFromHips: Vector3,
  out: Vector3
): Vector3 {
  standingFootTarget(hips, bodyDelta, restOffsetFromHips, SITTING_FOOT_HEIGHT, out);
  out.x += forward.x * SITTING_FOOT_FORWARD;
  out.z += forward.z * SITTING_FOOT_FORWARD;
  return out;
}

/** The angle brought into (-pi, pi] */
function wrapAngle(angle: number): number {
  let wrapped = angle % (2 * Math.PI);
  if (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  else if (wrapped <= -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
}

/** A point of root space on the floor: turned by the rig's heading and moved to the rig's place; the height is kept */
function toFloor(point: Vector3, floor: FloorFrame, out: Vector3): Vector3 {
  const cos = Math.cos(floor.yaw);
  const sin = Math.sin(floor.yaw);
  return out.set(cos * point.x + sin * point.z + floor.x, point.y, -sin * point.x + cos * point.z + floor.z);
}

/** A point of the floor in root space */
function toRoot(point: Vector3, floor: FloorFrame, out: Vector3): Vector3 {
  const cos = Math.cos(floor.yaw);
  const sin = Math.sin(floor.yaw);
  const x = point.x - floor.x;
  const z = point.z - floor.z;
  return out.set(cos * x - sin * z, point.y, sin * x + cos * z);
}

function horizontalDistance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Eases a step in and out: 0 to 1 over 0 to 1, slow at both ends */
function ease(u: number): number {
  return u * u * (3 - 2 * u);
}

const hipsOnFloor = new Vector3();
const place: Record<FootSide, Vector3> = { left: new Vector3(), right: new Vector3() };
const lead = new Vector3();
const moved = new Vector3();

/** Puts the foot down at once: at the place, pointing the body's way, without a step */
function plant(foot: FootPlacement, at: Vector3, bodyYaw: number) {
  foot.floor.copy(at);
  foot.floorYaw = bodyYaw;
  foot.planted = true;
  foot.stepping = false;
}

/** How much a planted foot wants to step: over 1, it does. The larger of how far it is from its place and how far the body has turned from it */
function urgencyOf(foot: FootPlacement, at: Vector3, bodyYaw: number, settling: boolean): number {
  const distance = horizontalDistance(foot.floor, at);
  const urgency = Math.max(distance / STEP_DISTANCE, Math.abs(wrapAngle(bodyYaw - foot.floorYaw)) / STEP_YAW);
  // Standing still, a foot left away from its place by the last steps comes home
  return settling && distance > SETTLE_DISTANCE ? Math.max(urgency, 1 + distance) : urgency;
}

/**
 * Moves the feet for one frame. `targets` are the places under the hips where the feet would stand now and
 * `hips` the hips, all in root space; `bodyYaw` is the body's heading in root space; `floor` puts root
 * space on the floor; `deltaSeconds` is the time since the previous frame. With `plants` false (sitting)
 * the feet follow their targets as they are and take new places when the body stands again.
 *
 * Afterwards each foot's `position` and `yaw` say where it is and which way it points this frame, in root
 * space: on the floor at its place, or on its way through a step, lifted.
 */
export function stepGait(
  gait: Gait,
  targets: Record<FootSide, Vector3>,
  hips: Vector3,
  bodyYaw: number,
  floor: FloorFrame,
  deltaSeconds: number,
  plants: boolean
) {
  if (!plants) {
    for (const side of SIDES) {
      const foot = gait.feet[side];
      foot.position.copy(targets[side]);
      foot.yaw = bodyYaw;
      foot.planted = false;
      foot.stepping = false;
    }
    gait.hasHips = false;
    gait.velocity.set(0, 0, 0);
    gait.idleSeconds = 0;
    return;
  }

  const bodyYawOnFloor = bodyYaw + floor.yaw;

  // How fast the body moves over the floor, and whether it was moved at once
  toFloor(hips, floor, hipsOnFloor);
  let teleported = false;
  if (gait.hasHips) {
    moved.subVectors(hipsOnFloor, gait.hips).setY(0);
    teleported = moved.length() > TELEPORT_DISTANCE;
    if (teleported) {
      gait.velocity.set(0, 0, 0);
    } else if (deltaSeconds > 0) {
      gait.velocity.lerp(moved.divideScalar(deltaSeconds), 1 - Math.exp(-deltaSeconds / SPEED_TIME_CONSTANT));
    }
  }
  gait.hips.copy(hipsOnFloor);
  gait.hasHips = true;
  const speed = gait.velocity.length();
  gait.idleSeconds = speed < IDLE_SPEED ? gait.idleSeconds + deltaSeconds : 0;
  const settling = gait.idleSeconds > SETTLE_AFTER_SECONDS;

  // A step is as long as it takes to cover the stride at this speed, and a foot lands ahead of its place
  const stepSeconds = Math.min(MAX_STEP_SECONDS, Math.max(MIN_STEP_SECONDS, STRIDE_REACH / Math.max(speed, 1e-3)));
  lead.copy(gait.velocity).multiplyScalar(LEAD_SHARE * stepSeconds);

  for (const side of SIDES) {
    const foot = gait.feet[side];
    toFloor(targets[side], floor, place[side]);
    if (!foot.planted || teleported) plant(foot, place[side], bodyYawOnFloor);
    place[side].x += lead.x;
    place[side].z += lead.z;
  }

  // Steps under way
  for (const side of SIDES) {
    const foot = gait.feet[side];
    if (!foot.stepping) continue;
    foot.elapsed += deltaSeconds;
    const u = Math.min(1, foot.elapsed / foot.duration);
    const k = ease(u);
    // The landing place is read again every frame, so the foot lands where the body is by then
    foot.floor.x = foot.from.x + (place[side].x - foot.from.x) * k;
    foot.floor.z = foot.from.z + (place[side].z - foot.from.z) * k;
    foot.floorYaw = foot.fromYaw + wrapAngle(bodyYawOnFloor - foot.fromYaw) * k;
    if (u >= 1) foot.stepping = false;
  }

  // The foot that wants it most starts a step, while the other stands, or at once when it is far behind
  let next: FootSide | null = null;
  let nextUrgency = 1;
  for (const side of SIDES) {
    const foot = gait.feet[side];
    if (foot.stepping) continue;
    const urgency = urgencyOf(foot, place[side], bodyYawOnFloor, settling);
    if (urgency > nextUrgency) {
      next = side;
      nextUrgency = urgency;
    }
  }
  if (next) {
    const foot = gait.feet[next];
    const other = gait.feet[next === "left" ? "right" : "left"];
    const distance = horizontalDistance(foot.floor, place[next]);
    if (!other.stepping || distance > FORCE_DISTANCE) {
      foot.stepping = true;
      foot.from.copy(foot.floor);
      foot.fromYaw = foot.floorYaw;
      foot.elapsed = 0;
      foot.duration = stepSeconds;
      foot.lift = Math.min(MAX_LIFT, Math.max(MIN_LIFT, LIFT_SHARE * distance));
    }
  }

  for (const side of SIDES) {
    const foot = gait.feet[side];
    // A planted foot that the body has left far behind is dragged along rather than left out of the leg's reach
    if (!foot.stepping) {
      const distance = horizontalDistance(foot.floor, place[side]);
      if (distance > MAX_REACH) {
        const pull = (distance - MAX_REACH) / distance;
        foot.floor.x += (place[side].x - foot.floor.x) * pull;
        foot.floor.z += (place[side].z - foot.floor.z) * pull;
      }
    }
    toRoot(foot.floor, floor, foot.position);
    const lifted = foot.stepping ? foot.lift * Math.sin(Math.PI * Math.min(1, foot.elapsed / foot.duration)) : 0;
    foot.position.y = targets[side].y + lifted;
    foot.yaw = foot.floorYaw - floor.yaw;
  }
}
