import test from "ava";
import { AnnouncedAvatars } from "../../../src/avatar/net/announced-avatars";

/**
 * What a received #avatarId announcement leads to (avatar/net/announced-avatars.ts): a new client, a
 * repeat, a change of avatar, and a client the user hid and shows again.
 */

test("a new client's announcement loads its model and asks for the own announcement back", t => {
  const announced = new AnnouncedAvatars(new Set());
  t.deepEqual(announced.receive("a", "avatar1"), { isNewClient: true, load: true });
});

test("a repeated announcement loads nothing", t => {
  const announced = new AnnouncedAvatars(new Set());
  announced.receive("a", "avatar1");
  t.deepEqual(announced.receive("a", "avatar1"), { isNewClient: false, load: false });
});

test("a change of avatar loads the new one", t => {
  const announced = new AnnouncedAvatars(new Set());
  announced.receive("a", "avatar1");
  t.deepEqual(announced.receive("a", "avatar2"), { isNewClient: false, load: true });
  t.is(announced.avatarIdOf("a"), "avatar2");
});

test("a hidden client's announcements, repeated or changed, load nothing but are recorded", t => {
  const announced = new AnnouncedAvatars(new Set());
  announced.receive("a", "avatar1");
  announced.hide("a");
  t.true(announced.isHidden("a"));
  t.false(announced.receive("a", "avatar1").load);
  t.false(announced.receive("a", "avatar2").load);
  t.is(announced.avatarIdOf("a"), "avatar2");
});

test("showing a client again gives the avatar it announced last, and its repeats load nothing after", t => {
  const announced = new AnnouncedAvatars(new Set());
  announced.receive("a", "avatar1");
  announced.hide("a");
  announced.receive("a", "avatar2");
  t.is(announced.show("a"), "avatar2");
  t.false(announced.isHidden("a"));
  t.false(announced.receive("a", "avatar2").load);
});

test("a client hidden before it announced anything is shown with nothing to load", t => {
  const announced = new AnnouncedAvatars(new Set());
  announced.hide("a");
  t.deepEqual(announced.receive("a", "avatar1"), { isNewClient: true, load: false });
  t.is(new AnnouncedAvatars(new Set()).show("b"), undefined);
});

test("a hidden client that leaves stays hidden when it comes back, also for another session of the page", t => {
  const hidden = new Set();
  const room = new AnnouncedAvatars(hidden);
  room.receive("a", "avatar1");
  room.hide("a");
  room.forget("a");
  t.deepEqual(room.receive("a", "avatar1"), { isNewClient: true, load: false });
  const replacement = new AnnouncedAvatars(hidden);
  t.false(replacement.receive("a", "avatar1").load);
});

test("an unchanged avatar loads again only after its client was forgotten", t => {
  const announced = new AnnouncedAvatars(new Set());
  announced.receive("a", "avatar1");
  for (let repeat = 0; repeat < 5; repeat++) t.false(announced.receive("a", "avatar1").load);
  announced.forget("a");
  t.deepEqual(announced.receive("a", "avatar1"), { isNewClient: true, load: true });
});
