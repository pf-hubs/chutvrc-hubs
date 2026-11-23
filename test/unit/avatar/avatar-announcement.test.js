import test from "ava";
import {
  encodeAvatarAnnouncement,
  isAnnounceableEyeHeight,
  MAX_ANNOUNCED_EYE_HEIGHT,
  MIN_ANNOUNCED_EYE_HEIGHT,
  parseAvatarAnnouncement
} from "../../../src/avatar/net/avatar-announcement";

/**
 * The #avatarId message with the optional third field, the standing eye height in room metres
 * (avatar/net/avatar-announcement.ts): absent, valid, malformed and out of range, and how an old build that
 * reads the first two fields sees it.
 */

/** How the builds before the third field read the message (pose-sync.ts, handleAvatarIdMessage) */
function oldBuildReads(message) {
  const [clientId, avatarId] = message.split("|");
  return { clientId, avatarId };
}

test("encode: no eye height gives the two-field message of the old builds", t => {
  t.is(encodeAvatarAnnouncement("abc", "avatar1"), "abc|avatar1");
  t.is(encodeAvatarAnnouncement("abc", "avatar1", undefined), "abc|avatar1");
});

test("encode: an eye height goes out in metres with three decimals", t => {
  t.is(encodeAvatarAnnouncement("abc", "avatar1", 1.5976), "abc|avatar1|1.598");
  t.is(encodeAvatarAnnouncement("abc", "avatar1", 1.6), "abc|avatar1|1.600");
  t.is(encodeAvatarAnnouncement("abc", "avatar1", 0.468), "abc|avatar1|0.468");
});

test("encode: an eye height that cannot be announced is left out", t => {
  for (const bad of [NaN, Infinity, -1, 0, MIN_ANNOUNCED_EYE_HEIGHT - 0.001, MAX_ANNOUNCED_EYE_HEIGHT + 0.001]) {
    t.is(encodeAvatarAnnouncement("abc", "avatar1", bad), "abc|avatar1", `eye height ${bad}`);
  }
});

test("parse: absent third field", t => {
  const parsed = parseAvatarAnnouncement("abc|avatar1");
  t.is(parsed.clientId, "abc");
  t.is(parsed.avatarId, "avatar1");
  t.is(parsed.eyeHeight, undefined);
});

test("parse: a valid third field", t => {
  const parsed = parseAvatarAnnouncement("abc|avatar1|1.598");
  t.is(parsed.clientId, "abc");
  t.is(parsed.avatarId, "avatar1");
  t.is(parsed.eyeHeight, 1.598);
  t.is(parseAvatarAnnouncement("abc|avatar1|2").eyeHeight, 2);
  // A fourth field from a later build is ignored
  t.is(parseAvatarAnnouncement("abc|avatar1|1.500|something").eyeHeight, 1.5);
});

test("parse: a malformed third field counts as absent, the ids stay", t => {
  for (const field of [
    "",
    "abc",
    "1.5m",
    "1,5",
    " 1.5",
    "1.5 ",
    "-1.5",
    "+1.5",
    "1e0",
    ".5",
    "1.",
    "NaN",
    "Infinity",
    "0x1"
  ]) {
    const parsed = parseAvatarAnnouncement(`abc|avatar1|${field}`);
    t.is(parsed.eyeHeight, undefined, `field "${field}"`);
    t.is(parsed.clientId, "abc");
    t.is(parsed.avatarId, "avatar1");
  }
});

test("parse: an out-of-range third field counts as absent", t => {
  for (const field of ["0", "0.000", "0.099", "10.001", "25", "1000"]) {
    t.is(parseAvatarAnnouncement(`abc|avatar1|${field}`).eyeHeight, undefined, `field "${field}"`);
  }
  t.is(parseAvatarAnnouncement("abc|avatar1|0.100").eyeHeight, 0.1);
  t.is(parseAvatarAnnouncement("abc|avatar1|10.000").eyeHeight, 10);
});

test("parse: missing ids come back empty, as the receiver's check expects", t => {
  t.is(parseAvatarAnnouncement("").clientId, "");
  t.is(parseAvatarAnnouncement("").avatarId, "");
  t.is(parseAvatarAnnouncement("abc").avatarId, "");
  t.is(parseAvatarAnnouncement("abc|").avatarId, "");
});

test("round trip, and an old build reads the same two ids with or without the eye height", t => {
  for (const eyeHeight of [undefined, 0.468, 1.4976, 1.6, 2.34, 3.2]) {
    const message = encodeAvatarAnnouncement("client-1", "https://example.org/a.glb", eyeHeight);
    const parsed = parseAvatarAnnouncement(message);
    t.is(parsed.clientId, "client-1");
    t.is(parsed.avatarId, "https://example.org/a.glb");
    t.is(parsed.eyeHeight, eyeHeight === undefined ? undefined : Number(eyeHeight.toFixed(3)));
    const old = oldBuildReads(message);
    t.is(old.clientId, "client-1");
    t.is(old.avatarId, "https://example.org/a.glb");
  }
});

test("announceable range", t => {
  t.true(isAnnounceableEyeHeight(MIN_ANNOUNCED_EYE_HEIGHT));
  t.true(isAnnounceableEyeHeight(MAX_ANNOUNCED_EYE_HEIGHT));
  t.true(isAnnounceableEyeHeight(1.6));
  t.is(isAnnounceableEyeHeight("1.6"), false);
  t.is(isAnnounceableEyeHeight(null), false);
  t.is(isAnnounceableEyeHeight(undefined), false);
});
