import test from "ava";
import { PoseSender, SEND_INTERVAL_MS } from "../../../src/avatar/net/pose-sender";
import { POSE_CHANNEL } from "../../../src/avatar/net/pose-codec-v1";
import { createTrackedPose } from "../../../src/avatar/pose/tracked-pose";

/**
 * The own pose goes out only while the sender may publish (avatar/net/pose-sender.ts): a client still in
 * the lobby samples its pose but sends nothing, from the frame loop or outside it, and sends with the first
 * frame after it entered.
 */

function senderWith(mayPublish) {
  const sent = [];
  const sfu = { broadcastUint8: (channel, packet) => sent.push(channel), bus: { isRecording: false } };
  const pose = createTrackedPose();
  pose.receivedAt = 1;
  const store = { get: () => pose };
  const sender = new PoseSender(sfu, store, mayPublish);
  sender.setClientId("me");
  let samples = 0;
  sender.source = { sample: () => samples++ };
  return { sender, sent, samples: () => samples };
}

test("a client in the lobby samples its pose but sends nothing", t => {
  const { sender, sent, samples } = senderWith(() => false);
  for (let frame = 0; frame < 10; frame++) sender.tick(frame * SEND_INTERVAL_MS * 2);
  sender.sendAll();
  t.is(sent.length, 0);
  t.is(samples(), 10);
});

test("sending starts with the first frame after entry", t => {
  let entered = false;
  const { sender, sent } = senderWith(() => entered);
  sender.tick(1000);
  sender.tick(1001);
  t.is(sent.length, 0);
  entered = true;
  sender.tick(1002);
  t.deepEqual(sent, [POSE_CHANNEL]);
  sender.sendAll();
  t.is(sent.length, 2);
});

test("without a gate the sender sends as before", t => {
  const sent = [];
  const pose = createTrackedPose();
  pose.receivedAt = 1;
  const sender = new PoseSender(
    { broadcastUint8: channel => sent.push(channel), bus: { isRecording: false } },
    {
      get: () => pose
    }
  );
  sender.setClientId("me");
  sender.tick(0);
  sender.tick(SEND_INTERVAL_MS / 2);
  sender.tick(SEND_INTERVAL_MS);
  t.is(sent.length, 2);
});
