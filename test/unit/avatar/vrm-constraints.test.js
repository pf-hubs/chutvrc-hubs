import test from "ava";
import { Object3D, Quaternion, Vector3 } from "three";
import { applyVrmConstraints } from "../../../src/avatar/ik/vrm-constraints";
import { readVrmConstraints } from "../../../src/avatar/rig/vrm-constraints";

/**
 * The node constraints of a VRM 1.0 model: read from a loaded glTF's document and applied after the
 * humanoid bones are posed. The models here are a few nodes each, with the document and the loader's
 * associations built by hand.
 */

const DEG = Math.PI / 180;
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

/**
 * A glTF as the loader leaves it: `nodes` is a list of [name, parent index or null, position, rotation as
 * [axis, degrees] or null, constraint or null]. Returns the objects by name and the constraints read.
 */
function load(nodes) {
  const scene = new Object3D();
  const objects = [];
  const associations = new Map();
  const json = { nodes: [] };
  nodes.forEach(([name, parent, position, rotation, constraint], index) => {
    const object = new Object3D();
    object.name = name;
    object.position.fromArray(position);
    if (rotation) object.quaternion.setFromAxisAngle(rotation[0], rotation[1] * DEG);
    (parent === null ? scene : objects[parent]).add(object);
    objects.push(object);
    associations.set(object, { nodes: index });
    json.nodes.push(constraint ? { extensions: { VRMC_node_constraint: { constraint } } } : {});
  });
  scene.updateMatrixWorld(true);
  const constraints = readVrmConstraints({ parser: { json, associations } });
  return { scene, byName: Object.fromEntries(objects.map(object => [object.name, object])), constraints };
}

/** Sets a node's local rotation as a solver does: the quaternion, then its matrix */
function turn(object, quaternion) {
  object.quaternion.copy(quaternion);
  object.updateMatrix();
}

function apply(model) {
  model.scene.updateMatrixWorld(true);
  applyVrmConstraints(model.constraints);
  model.scene.updateMatrixWorld(true);
}

const degrees = (a, b) => a.angleTo(b) / DEG;
const about = (axis, angle) => new Quaternion().setFromAxisAngle(axis, angle * DEG);

test("a model without constraints, or without a document, has none", t => {
  t.deepEqual(readVrmConstraints({}), []);
  t.deepEqual(readVrmConstraints({ parser: { json: {} } }), []);
  t.is(load([["a", null, [0, 0, 0], null, null]]).constraints.length, 0);
});

test("a constraint with a node missing from the scene or an unknown axis is left out; the weight is kept within 0 to 1", t => {
  const model = load([
    ["source", null, [0, 0, 0], null, null],
    ["noSource", null, [0, 0, 0], null, { rotation: { source: 99 } }],
    ["badAxis", null, [0, 0, 0], null, { roll: { source: 0, rollAxis: "W" } }],
    ["heavy", null, [0, 0, 0], null, { rotation: { source: 0, weight: 3 } }],
    ["plain", null, [0, 0, 0], null, { aim: { source: 0, aimAxis: "NegativeY" } }]
  ]);
  t.deepEqual(model.constraints.map(c => c.destination.name).sort(), ["heavy", "plain"]);
  t.is(model.constraints.find(c => c.destination.name === "heavy").weight, 1);
  t.is(model.constraints.find(c => c.destination.name === "plain").weight, 1, "a weight left out is 1");
});

test("rotation: the destination takes the source's turn from its rest pose, blended by the weight", t => {
  for (const weight of [1, 0.5, 0.25]) {
    const model = load([
      ["source", null, [0, 0, 0], [Z, 30], null],
      ["destination", null, [1, 0, 0], [X, -45], { rotation: { source: 0, weight } }]
    ]);
    const { source, destination } = model.byName;
    const rest = destination.quaternion.clone();
    apply(model);
    t.true(degrees(destination.quaternion, rest) < 1e-6, `weight ${weight}: nothing moves while the source rests`);

    // The source turns a further 80° about its own y axis
    turn(source, about(Z, 30).multiply(about(Y, 80)));
    apply(model);
    const expected = rest.clone().multiply(about(Y, 80 * weight));
    t.true(degrees(destination.quaternion, expected) < 1e-4, `weight ${weight}: ${degrees(destination.quaternion, expected).toFixed(5)}° off`);
  }
});

test("roll: the destination takes only the source's twist about the roll axis", t => {
  for (const weight of [1, 0.5]) {
    // A forearm along x with a hand at its end, and a twist bone beside the hand: the sample model's layout
    const model = load([
      ["forearm", null, [0, 1, 0], null, null],
      ["hand", 0, [0.25, 0, 0], null, null],
      ["twist", 0, [0.2, 0, 0], null, { roll: { source: 1, rollAxis: "X", weight } }]
    ]);
    const { hand, twist } = model.byName;

    // The hand twists 70° about the arm and also bends 40° at the wrist
    turn(hand, about(X, 70).multiply(about(Z, 40)));
    apply(model);
    const axisAfter = X.clone().applyQuaternion(twist.quaternion);
    t.true(degrees(axisAfter, X) < 1e-4, `weight ${weight}: the twist bone stays along the arm (${degrees(axisAfter, X).toFixed(5)}° off)`);
    const twisted = 2 * Math.atan2(twist.quaternion.x, twist.quaternion.w) / DEG;
    t.true(Math.abs(twisted - 70 * weight) < 1e-3, `weight ${weight}: it turns ${twisted.toFixed(3)}° about the arm, of the hand's 70°`);

    // A bend alone gives no twist
    turn(hand, about(Z, 40));
    apply(model);
    t.true(degrees(twist.quaternion, new Quaternion()) < 1e-4, `weight ${weight}: a bend alone leaves it at rest`);
  }
});

test("roll: rest rotations of the source and the destination do not leak into the result", t => {
  const model = load([
    ["forearm", null, [0, 1, 0], [Y, 25], null],
    ["hand", 0, [0.25, 0, 0], [Z, 15], null],
    ["twist", 0, [0.2, 0, 0], [Y, -10], { roll: { source: 1, rollAxis: "X", weight: 1 } }]
  ]);
  const { hand, twist } = model.byName;
  const rest = twist.quaternion.clone();
  apply(model);
  // Not exact: turning a rotation by its rest and back leaves rounding in the last digits
  t.true(degrees(twist.quaternion, rest) < 1e-4, "at rest the destination keeps its rest rotation");
  // The hand twists about the forearm's x axis, expressed in the forearm's frame
  turn(hand, about(X, 50).multiply(about(Z, 15)));
  apply(model);
  const fromRest = rest.clone().invert().multiply(twist.quaternion);
  const axis = new Vector3(fromRest.x, fromRest.y, fromRest.z).normalize();
  t.true(degrees(axis, X) < 1 || degrees(axis, X.clone().negate()) < 1, "the destination turned about its own x axis only");
});

test("aim: the destination's axis points at the source wherever the source and the parent go", t => {
  for (const [aimAxis, axis] of [["PositiveX", X], ["NegativeX", X.clone().negate()], ["NegativeY", Y.clone().negate()]]) {
    // A shoulder with an upper arm and a lower arm below it, and a sleeve bone that hangs from the shoulder
    const model = load([
      ["shoulder", null, [0, 1.4, 0], [Y, 20], null],
      ["upperArm", 0, [0.1, 0, 0], null, null],
      ["lowerArm", 1, [0.25, 0, 0], null, null],
      ["sleeve", 0, [0.1, 0, 0], [Z, 35], { aim: { source: 2, aimAxis, weight: 1 } }]
    ]);
    const { shoulder, upperArm, lowerArm, sleeve } = model.byName;
    const poses = [
      [new Quaternion(), new Quaternion()],
      [about(Z, -80), new Quaternion()],
      [about(Z, -60).multiply(about(Y, 40)), about(X, 30)],
      [about(X, 100), about(Y, 20).multiply(about(Z, -50))]
    ];
    for (const [arm, shoulderTurn] of poses) {
      turn(upperArm, arm);
      turn(shoulder, about(Y, 20).multiply(shoulderTurn));
      apply(model);
      const pointing = axis.clone().applyQuaternion(sleeve.getWorldQuaternion(new Quaternion()));
      const toSource = lowerArm.getWorldPosition(new Vector3()).sub(sleeve.getWorldPosition(new Vector3())).normalize();
      t.true(degrees(pointing, toSource) < 1e-3, `${aimAxis}: ${degrees(pointing, toSource).toFixed(5)}° off the source`);
    }
  }
});

test("aim: half the weight goes half the way from the rest pose", t => {
  const model = load([
    ["parent", null, [0, 0, 0], null, null],
    ["target", null, [0, 1, 0], null, null],
    ["aimer", 0, [0, 0, 0], null, { aim: { source: 1, aimAxis: "PositiveX", weight: 0.5 } }]
  ]);
  apply(model);
  const pointing = X.clone().applyQuaternion(model.byName.aimer.quaternion);
  t.true(Math.abs(degrees(pointing, X) - 45) < 1e-3, `the axis is ${degrees(pointing, X).toFixed(3)}° from rest, of the 90° to the source`);
});

test("constraints are applied after the ones they read: a chain gives the same result in any listed order", t => {
  // "second" copies "first", which copies "driver"; "aimer" hangs from "second" and points at "far"
  const nodes = order => {
    const all = {
      driver: ["driver", null, [0, 0, 0], null, null],
      far: ["far", null, [3, 2, 1], null, null],
      first: ["first", null, [0, 1, 0], null, { rotation: { source: "driver", weight: 1 } }],
      second: ["second", null, [0, 2, 0], null, { rotation: { source: "first", weight: 1 } }],
      aimer: ["aimer", "second", [0.5, 0, 0], null, { aim: { source: "far", aimAxis: "PositiveX", weight: 1 } }]
    };
    const index = name => order.indexOf(name);
    return order.map(name => {
      const [n, parent, position, rotation, constraint] = all[name];
      const resolved = constraint && JSON.parse(JSON.stringify(constraint));
      if (resolved) for (const kind of Object.keys(resolved)) resolved[kind].source = index(resolved[kind].source);
      return [n, parent === null ? null : index(parent), position, rotation, resolved];
    });
  };
  // Parents must come before their children in the list; the constraints' order is what varies
  const orders = [
    ["driver", "far", "first", "second", "aimer"],
    ["far", "second", "aimer", "first", "driver"],
    ["second", "first", "driver", "aimer", "far"]
  ];
  const results = orders.map(order => {
    const model = load(nodes(order));
    turn(model.byName.driver, about(Z, 70).multiply(about(X, 20)));
    // One pass must be enough
    apply(model);
    return {
      order: model.constraints.map(c => c.destination.name),
      second: model.byName.second.quaternion.clone(),
      aimer: model.byName.aimer.getWorldQuaternion(new Quaternion())
    };
  });
  for (const result of results) {
    t.true(result.order.indexOf("first") < result.order.indexOf("second"), `"first" before "second": ${result.order}`);
    t.true(result.order.indexOf("second") < result.order.indexOf("aimer"), `"second" before "aimer": ${result.order}`);
    t.true(degrees(result.second, about(Z, 70).multiply(about(X, 20))) < 1e-4, "the turn reached the end of the chain in one pass");
    t.true(degrees(result.aimer, results[0].aimer) < 1e-4, "the aim, taken from where its parent ended up, is the same");
  }
});
