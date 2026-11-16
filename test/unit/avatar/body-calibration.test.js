import test from "ava";
import {
  DEFAULT_BODY_FIT,
  DEFAULT_BODY_POSTURE,
  deriveBodyCalibration,
  isCalibratedHeight,
  MAX_BODY_HEIGHT_CM,
  MIN_BODY_HEIGHT_CM,
  modelRatioOf,
  parseBodyFit,
  parseBodyPosture,
  standingEyeHeightOf,
  UNCALIBRATED_BODY_HEIGHT_CM
} from "../../../src/avatar/calibration/body-calibration";

/**
 * The body calibration's derivation (avatar/calibration/body-calibration.ts): standing and sitting, both
 * fits, three model eye heights, the clamps, the mismatch flag and a missing capture. Every expected value
 * is worked out by hand in the comment beside it; the derivation must match it within 1e-9 m.
 *
 * The standing eye height of an entered height is 93.6 % of it:
 * 160 cm -> 1.4976 m, 170 cm -> 1.5912 m, 185 cm -> 1.7316 m, 50 cm -> 0.468 m, 250 cm -> 2.34 m.
 */

const TOLERANCE = 1e-9;
/** Three models: a short one, one of an average adult's eye height and a tall one, in metres */
const MODEL_EYE_HEIGHTS = [1.2, 1.6, 1.75];

function near(t, actual, expected, label) {
  t.true(Math.abs(actual - expected) < TOLERANCE, `${label}: ${actual} against ${expected}`);
}

function check(t, label, input, expected) {
  const result = deriveBodyCalibration(input);
  for (const key of ["playerEyeHeight", "trackingOffsetY", "rigScale", "modelRatio", "announcedEyeHeight"]) {
    near(t, result[key], expected[key], `${label}, ${key}`);
  }
  t.is(result.heightMismatch, expected.heightMismatch, `${label}, heightMismatch`);
  return result;
}

test("the entered height: its range, the not-calibrated value, the defaults, the eye height", t => {
  t.is(MIN_BODY_HEIGHT_CM, 50);
  t.is(MAX_BODY_HEIGHT_CM, 250);
  t.is(UNCALIBRATED_BODY_HEIGHT_CM, 0);
  t.is(DEFAULT_BODY_POSTURE, "standing");
  t.is(DEFAULT_BODY_FIT, "avatarToPlayer");
  for (const valid of [50, 50.5, 170, 250]) t.true(isCalibratedHeight(valid), `${valid} cm is a height`);
  for (const invalid of [0, 49.9, 250.1, -170, NaN, Infinity, "170", null, undefined]) {
    t.is(isCalibratedHeight(invalid), false, `${String(invalid)} is not a height`);
  }
  near(t, standingEyeHeightOf(170), 1.5912, "170 cm"); // 1.7 * 0.936
  near(t, standingEyeHeightOf(160), 1.4976, "160 cm"); // 1.6 * 0.936
  near(t, standingEyeHeightOf(185), 1.7316, "185 cm"); // 1.85 * 0.936
  t.is(parseBodyPosture("sitting"), "sitting");
  t.is(parseBodyPosture("standing"), "standing");
  t.is(parseBodyPosture("lying"), "standing");
  t.is(parseBodyPosture(undefined), "standing");
  t.is(parseBodyFit("playerToAvatar"), "playerToAvatar");
  t.is(parseBodyFit("avatarToPlayer"), "avatarToPlayer");
  t.is(parseBodyFit("both"), "avatarToPlayer");
  t.is(parseBodyFit(undefined), "avatarToPlayer");
});

test("standing with a capture, both fits, three models: the capture is the eye height", t => {
  // 170 cm entered, the headset captured at 1.60 m: P = 1.60; |1.60 - 1.5912| = 0.0088 m, no mismatch
  const input = { heightCm: 170, posture: "standing", capturedHeadHeight: 1.6 };
  const avatarToPlayer = [
    1.333333333333, // 1.60 / 1.20
    1, // 1.60 / 1.60
    0.914285714286 // 1.60 / 1.75
  ];
  const playerToAvatar = [
    0.75, // 1.20 / 1.60
    1, // 1.60 / 1.60
    1.09375 // 1.75 / 1.60
  ];
  MODEL_EYE_HEIGHTS.forEach((modelEyeHeight, i) => {
    check(
      t,
      `fit the avatar to me, model ${modelEyeHeight}`,
      { ...input, fit: "avatarToPlayer", modelEyeHeight },
      {
        playerEyeHeight: 1.6,
        trackingOffsetY: 0,
        rigScale: 1,
        modelRatio: avatarToPlayer[i],
        announcedEyeHeight: 1.6,
        heightMismatch: false
      }
    );
    const result = check(
      t,
      `fit me to the avatar, model ${modelEyeHeight}`,
      { ...input, fit: "playerToAvatar", modelEyeHeight },
      {
        playerEyeHeight: 1.6,
        trackingOffsetY: 0,
        rigScale: playerToAvatar[i],
        modelRatio: 1,
        announcedEyeHeight: modelEyeHeight,
        heightMismatch: false
      }
    );
    // The scaled rig puts the player's eyes at the model's
    near(t, result.playerEyeHeight * result.rigScale, modelEyeHeight, `eyes at the model's, model ${modelEyeHeight}`);
  });
});

test("standing without a capture, both fits, three models: the entered height stands in", t => {
  // 160 cm entered: P = 1.4976
  const input = { heightCm: 160, posture: "standing", capturedHeadHeight: null };
  const avatarToPlayer = [
    1.248, // 1.4976 / 1.20
    0.936, // 1.4976 / 1.60
    0.855771428571 // 1.4976 / 1.75
  ];
  const playerToAvatar = [
    0.801282051282, // 1.20 / 1.4976
    1.068376068376, // 1.60 / 1.4976 = 1 / 0.936
    1.168536324786 // 1.75 / 1.4976 = 1.09375 / 0.936
  ];
  MODEL_EYE_HEIGHTS.forEach((modelEyeHeight, i) => {
    check(
      t,
      `fit the avatar to me, model ${modelEyeHeight}`,
      { ...input, fit: "avatarToPlayer", modelEyeHeight },
      {
        playerEyeHeight: 1.4976,
        trackingOffsetY: 0,
        rigScale: 1,
        modelRatio: avatarToPlayer[i],
        announcedEyeHeight: 1.4976,
        heightMismatch: false
      }
    );
    check(
      t,
      `fit me to the avatar, model ${modelEyeHeight}`,
      { ...input, fit: "playerToAvatar", modelEyeHeight },
      {
        playerEyeHeight: 1.4976,
        trackingOffsetY: 0,
        rigScale: playerToAvatar[i],
        modelRatio: 1,
        announcedEyeHeight: modelEyeHeight,
        heightMismatch: false
      }
    );
  });
});

test("sitting with a capture, both fits, three models: the offset lifts the seated head to standing height", t => {
  // 185 cm entered, seated headset captured at 1.15 m: P = 1.7316, offset 1.7316 - 1.15 = 0.5816
  const input = { heightCm: 185, posture: "sitting", capturedHeadHeight: 1.15 };
  const avatarToPlayer = [
    1.443, // 1.7316 / 1.20
    1.08225, // 1.7316 / 1.60
    0.989485714286 // 1.7316 / 1.75
  ];
  const playerToAvatar = [
    0.693000693001, // 1.20 / 1.7316
    0.924000924001, // 1.60 / 1.7316
    1.010626010626 // 1.75 / 1.7316 = 1 + 0.0184 / 1.7316
  ];
  MODEL_EYE_HEIGHTS.forEach((modelEyeHeight, i) => {
    check(
      t,
      `fit the avatar to me, model ${modelEyeHeight}`,
      { ...input, fit: "avatarToPlayer", modelEyeHeight },
      {
        playerEyeHeight: 1.7316,
        trackingOffsetY: 0.5816,
        rigScale: 1,
        modelRatio: avatarToPlayer[i],
        announcedEyeHeight: 1.7316,
        heightMismatch: false
      }
    );
    const result = check(
      t,
      `fit me to the avatar, model ${modelEyeHeight}`,
      { ...input, fit: "playerToAvatar", modelEyeHeight },
      {
        playerEyeHeight: 1.7316,
        trackingOffsetY: 0.5816,
        rigScale: playerToAvatar[i],
        modelRatio: 1,
        announcedEyeHeight: modelEyeHeight,
        heightMismatch: false
      }
    );
    // The seated head, lifted and scaled, sees from the model's eyes
    near(
      t,
      (1.15 + result.trackingOffsetY) * result.rigScale,
      modelEyeHeight,
      `seated eyes at the model's, model ${modelEyeHeight}`
    );
  });
  // A seated capture above the standing eye height gives a negative offset: 1.5912 - 1.65 = -0.0588
  check(
    t,
    "seated capture above standing eye height",
    { heightCm: 170, posture: "sitting", fit: "avatarToPlayer", capturedHeadHeight: 1.65, modelEyeHeight: 1.6 },
    {
      playerEyeHeight: 1.5912,
      trackingOffsetY: -0.0588,
      rigScale: 1,
      modelRatio: 0.9945, // 1.5912 / 1.60
      announcedEyeHeight: 1.5912,
      heightMismatch: false
    }
  );
});

test("sitting without a capture: no offset", t => {
  // 170 cm entered: P = 1.5912
  check(
    t,
    "fit the avatar to me",
    { heightCm: 170, posture: "sitting", fit: "avatarToPlayer", capturedHeadHeight: null, modelEyeHeight: 1.6 },
    {
      playerEyeHeight: 1.5912,
      trackingOffsetY: 0,
      rigScale: 1,
      modelRatio: 0.9945, // 1.5912 / 1.60
      announcedEyeHeight: 1.5912,
      heightMismatch: false
    }
  );
  check(
    t,
    "fit me to the avatar",
    { heightCm: 170, posture: "sitting", fit: "playerToAvatar", capturedHeadHeight: null, modelEyeHeight: 1.6 },
    {
      playerEyeHeight: 1.5912,
      trackingOffsetY: 0,
      rigScale: 1.005530417295, // 1.60 / 1.5912 = 1 + 0.0088 / 1.5912
      modelRatio: 1,
      announcedEyeHeight: 1.6,
      heightMismatch: false
    }
  );
});

test("the clamps: the entered height to 50 to 250 cm, the model ratio to 0.3 to 2.0, the rig scale not", t => {
  const standing = { posture: "standing", fit: "avatarToPlayer", capturedHeadHeight: null };
  // Heights out of range are brought into it: 40 -> 50 cm (0.468 m), 300 -> 250 cm (2.34 m), NaN -> 50 cm
  near(t, deriveBodyCalibration({ ...standing, heightCm: 40, modelEyeHeight: 1.2 }).playerEyeHeight, 0.468, "40 cm");
  near(t, deriveBodyCalibration({ ...standing, heightCm: 300, modelEyeHeight: 1.2 }).playerEyeHeight, 2.34, "300 cm");
  near(t, deriveBodyCalibration({ ...standing, heightCm: NaN, modelEyeHeight: 1.2 }).playerEyeHeight, 0.468, "NaN cm");
  // Fitting the avatar to a 50 cm player: 0.468 / 1.20 = 0.39 stays, 0.468 / 1.60 = 0.2925 and
  // 0.468 / 1.75 = 0.2674 are raised to 0.3
  const small = [0.39, 0.3, 0.3];
  MODEL_EYE_HEIGHTS.forEach((modelEyeHeight, i) => {
    near(
      t,
      deriveBodyCalibration({ ...standing, heightCm: 50, modelEyeHeight }).modelRatio,
      small[i],
      `50 cm, model ${modelEyeHeight}`
    );
  });
  // Fitting the avatar to a 250 cm player: 2.34 / 1.20 = 1.95 stays; a capture of 2.2 m on a model with
  // eyes at 1.0 m gives 2.2, lowered to 2.0 (230 cm: 2.1528 m, |2.2 - 2.1528| = 0.0472, no mismatch)
  near(t, deriveBodyCalibration({ ...standing, heightCm: 250, modelEyeHeight: 1.2 }).modelRatio, 1.95, "250 cm");
  const tall = check(
    t,
    "ratio over 2",
    { ...standing, heightCm: 230, capturedHeadHeight: 2.2, modelEyeHeight: 1.0 },
    {
      playerEyeHeight: 2.2,
      trackingOffsetY: 0,
      rigScale: 1,
      modelRatio: 2,
      announcedEyeHeight: 2.2, // the player's eye height, not the clamped model's
      heightMismatch: false
    }
  );
  t.is(tall.modelRatio, 2);
  // Fitting the 50 cm player to the tall model scales the rig by 1.75 / 0.468 = 3.7393..., unclamped
  near(
    t,
    deriveBodyCalibration({ ...standing, fit: "playerToAvatar", heightCm: 50, modelEyeHeight: 1.75 }).rigScale,
    3.739316239316,
    "rig scale"
  );
  // The ratio helper the observers use clamps the same way
  near(t, modelRatioOf(1.6, 1.2), 1.333333333333, "1.60 / 1.20");
  t.is(modelRatioOf(0.3, 1.6), 0.3, "0.3 / 1.6 = 0.1875 raised");
  t.is(modelRatioOf(5, 1), 2, "5 / 1 lowered");
  t.is(modelRatioOf(1.6, 0), 1, "no model eye height");
  t.is(modelRatioOf(NaN, 1.6), 1, "no eye height");
});

test("the mismatch flag: standing captures more than 15 cm from the entered eye height", t => {
  // 170 cm entered: eye height 1.5912 m
  const cases = [
    [1.75, true], // 0.1588 m above
    [1.44, true], // 0.1512 m below
    [1.73, false], // 0.1388 m above
    [1.45, false], // 0.1412 m below
    [1.5912, false]
  ];
  for (const [capturedHeadHeight, mismatch] of cases) {
    const result = deriveBodyCalibration({
      heightCm: 170,
      posture: "standing",
      fit: "avatarToPlayer",
      capturedHeadHeight,
      modelEyeHeight: 1.6
    });
    t.is(result.heightMismatch, mismatch, `capture ${capturedHeadHeight}`);
    near(t, result.playerEyeHeight, capturedHeadHeight, `capture ${capturedHeadHeight} is the eye height`);
  }
  // Never while sitting, never without a capture
  for (const posture of ["sitting", "standing"]) {
    const capturedHeadHeight = posture === "sitting" ? 0.9 : null;
    t.is(
      deriveBodyCalibration({ heightCm: 170, posture, fit: "avatarToPlayer", capturedHeadHeight, modelEyeHeight: 1.6 })
        .heightMismatch,
      false,
      posture
    );
  }
});

test("a missing capture and an unknown model eye height", t => {
  // Anything that is not a positive number counts as no capture: P from the entered height, 1.5912
  for (const capturedHeadHeight of [null, undefined, 0, -1, NaN, Infinity]) {
    for (const posture of ["standing", "sitting"]) {
      check(
        t,
        `${posture}, capture ${String(capturedHeadHeight)}`,
        { heightCm: 170, posture, fit: "avatarToPlayer", capturedHeadHeight, modelEyeHeight: 1.6 },
        {
          playerEyeHeight: 1.5912,
          trackingOffsetY: 0,
          rigScale: 1,
          modelRatio: 0.9945, // 1.5912 / 1.60
          announcedEyeHeight: 1.5912,
          heightMismatch: false
        }
      );
    }
  }
  // Without the model's eye height neither the model nor the rig is scaled, and the player's is announced
  for (const modelEyeHeight of [0, -1.6, NaN, undefined]) {
    for (const fit of ["avatarToPlayer", "playerToAvatar"]) {
      check(
        t,
        `${fit}, model ${String(modelEyeHeight)}`,
        { heightCm: 170, posture: "standing", fit, capturedHeadHeight: 1.6, modelEyeHeight },
        {
          playerEyeHeight: 1.6,
          trackingOffsetY: 0,
          rigScale: 1,
          modelRatio: 1,
          announcedEyeHeight: 1.6,
          heightMismatch: false
        }
      );
    }
  }
});
