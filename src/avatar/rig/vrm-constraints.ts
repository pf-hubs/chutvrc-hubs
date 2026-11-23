import { Object3D, Quaternion, Vector3 } from "three";
import { LoadedGltf, objectsByNodeIndex } from "./bone-map-vrm";

/**
 * The node constraints of a VRM 1.0 model (the glTF extension VRMC_node_constraint). A model uses them for
 * bones that are not part of the humanoid but must follow it: a sleeve bone that hangs from the shoulder
 * and points at the lower arm, a bone that takes half of the forearm's twist. A solver moves only the
 * humanoid bones, so these bones stay in the rest pose unless their constraints are evaluated each frame
 * (ik/vrm-constraints.ts). VRM 0.x has no such constraints.
 *
 * Each constraint moves one node, the destination, from another, the source:
 *
 * - roll: the destination takes the source's turn about one of the destination's own axes;
 * - aim: the destination turns so that one of its axes points at the source;
 * - rotation: the destination takes the source's whole turn.
 *
 * `weight` blends the result with the destination's rest rotation.
 */
export type VrmConstraintKind = "roll" | "aim" | "rotation";

export type VrmConstraint = {
  kind: VrmConstraintKind;
  destination: Object3D;
  source: Object3D;
  /** The roll axis or the aim axis, in the destination's own frame; unused for a rotation constraint */
  axis: Vector3;
  weight: number;
  /** The local rotations of the two nodes when the model was loaded */
  destinationRest: Quaternion;
  sourceRest: Quaternion;
  sourceRestInverse: Quaternion;
};

const ROLL_AXES: Readonly<Record<string, readonly [number, number, number]>> = {
  X: [1, 0, 0],
  Y: [0, 1, 0],
  Z: [0, 0, 1]
};
const AIM_AXES: Readonly<Record<string, readonly [number, number, number]>> = {
  PositiveX: [1, 0, 0],
  NegativeX: [-1, 0, 0],
  PositiveY: [0, 1, 0],
  NegativeY: [0, -1, 0],
  PositiveZ: [0, 0, 1],
  NegativeZ: [0, 0, -1]
};

/**
 * Orders the constraints so that each comes after the ones it reads the result of: a constraint reads its
 * source, and an aim constraint also where its own parent is, each together with everything above it. A
 * cycle, which a valid model does not have, is taken in the order the constraints came in.
 */
function inDependencyOrder(constraints: VrmConstraint[]): VrmConstraint[] {
  const byDestination = new Map<Object3D, VrmConstraint>();
  for (const constraint of constraints) byDestination.set(constraint.destination, constraint);

  const ordered: VrmConstraint[] = [];
  const visited = new Set<VrmConstraint>();
  const visit = (constraint: VrmConstraint) => {
    if (visited.has(constraint)) return;
    visited.add(constraint);
    const reads = constraint.kind === "aim" ? [constraint.source, constraint.destination.parent] : [constraint.source];
    for (const read of reads) {
      for (let object = read; object; object = object.parent) {
        const dependency = byDestination.get(object);
        if (dependency && dependency !== constraint) visit(dependency);
      }
    }
    ordered.push(constraint);
  };
  constraints.forEach(visit);
  return ordered;
}

/**
 * The node constraints of a loaded glTF, in the order they are to be applied; empty when the model has
 * none. Call it before the model is posed: the rest rotations are taken from the nodes as they are. A
 * constraint whose nodes are not in the loaded scene, or whose axis is not one the extension names, is
 * left out.
 */
export function readVrmConstraints(gltf: LoadedGltf): VrmConstraint[] {
  const nodes = gltf.parser?.json?.nodes;
  if (!nodes) return [];

  let objects: Map<number, Object3D> | null = null;
  const constraints: VrmConstraint[] = [];
  nodes.forEach((node, index) => {
    const declared = node?.extensions?.VRMC_node_constraint?.constraint;
    if (!declared) return;
    const kind: VrmConstraintKind | null = declared.roll ? "roll" : declared.aim ? "aim" : declared.rotation ? "rotation" : null;
    if (!kind) return;
    const spec = declared[kind]!;
    objects = objects ?? objectsByNodeIndex(gltf);
    const destination = objects.get(index);
    const source = typeof spec.source === "number" ? objects.get(spec.source) : undefined;
    if (!destination || !source) return;

    let axis: readonly [number, number, number] | undefined = [0, 0, 0];
    if (kind === "roll") axis = ROLL_AXES[declared.roll!.rollAxis ?? ""];
    else if (kind === "aim") axis = AIM_AXES[declared.aim!.aimAxis ?? ""];
    if (!axis) return;

    constraints.push({
      kind,
      destination,
      source,
      axis: new Vector3(axis[0], axis[1], axis[2]),
      weight: typeof spec.weight === "number" ? Math.min(1, Math.max(0, spec.weight)) : 1,
      destinationRest: destination.quaternion.clone(),
      sourceRest: source.quaternion.clone(),
      sourceRestInverse: source.quaternion.clone().invert()
    });
  });
  return inDependencyOrder(constraints);
}
