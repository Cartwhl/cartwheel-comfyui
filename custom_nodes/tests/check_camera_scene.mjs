// Run with Node 22+: node --experimental-default-type=module tests/check_camera_scene.mjs fixture.json [blender-reference.json]
// Fixtures point to local saved captures; no media or account data is bundled here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as THREE from "../web/vendor/build/three.module.js";
import { FBXLoader } from "../web/vendor/examples/jsm/loaders/FBXLoader.js";
import { CapturedScene } from "../web/camera_scene.js";

globalThis.window = { innerWidth: 1920, innerHeight: 1080 };
const fixture = JSON.parse(readFileSync(process.argv[2], "utf8"));
const buffers = fixture.files.map((path) => {
  const data = readFileSync(path);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
});
const scene = new CapturedScene(fixture.descriptor, buffers);
await scene.ready;
for (const [index, actor] of scene.actors.entries()) {
  const original = new FBXLoader().parse(buffers[index], "");
  const expected = [];
  const actual = [];
  const collect = (root, result) => root.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    result.push({ mesh: object.name, groups: object.geometry.groups,
      materials: materials.map((material) => ({ name: material.name, color: material.color.toArray(), opacity: material.opacity })) });
  });
  collect(original, expected);
  collect(actor.root, actual);
  for (const [index, mesh] of actual.entries()) {
    const source = expected[index];
    assert.equal(mesh.mesh, source.mesh);
    assert.deepEqual(mesh.groups, source.groups, "The preview changed clothing-face assignments.");
    assert.equal(mesh.materials.length, source.materials.length);
    for (const [slot, material] of mesh.materials.entries()) {
      const original = source.materials[slot];
      assert.equal(material.name, original.name);
      assert.equal(material.opacity, original.opacity);
      const name = material.name.toLowerCase();
      if (name === "body") {
        const [r, g, b] = material.color;
        assert.ok(r >= g && g >= b && b > 0.05, "The body is not a readable warm neutral.");
      } else if (!["shirt", "pants"].includes(name)) {
        assert.deepEqual(material.color, original.color, "An unrelated material changed color.");
      }
    }
  }
  original.traverse((object) => {
    object.geometry?.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material?.dispose();
  });
}
assert.equal(scene.actors.length, fixture.descriptor.actors.length);
assert.deepEqual(scene.actors.map((actor) => actor.number), fixture.descriptor.actors.map((actor, index) => actor.actor ?? index + 1));
assert.equal(scene.cameras.length, fixture.descriptor.camera.cameras.length);
const initialPosition = scene.camera.position.clone();
const initialDirection = scene.camera.getWorldDirection(new THREE.Vector3());
scene.setTime(scene.duration);
scene.setTime(0);
assert.ok(scene.camera.position.distanceTo(initialPosition) < 1e-7, "Seeking backward changed the initial camera pose.");
assert.ok(scene.camera.getWorldDirection(new THREE.Vector3()).distanceTo(initialDirection) < 1e-7);
const bounds = new THREE.Box3();
let meshes = 0;
for (const actor of scene.actors) {
  bounds.expandByObject(actor.root);
  actor.root.traverse((object) => {
    if (object.isMesh) {
      meshes++;
      assert.ok(object.geometry.getAttribute("normal"), "The preview mesh has no shading normals.");
    }
  });
}
assert.ok(meshes > 0);
const height = bounds.getSize(new THREE.Vector3()).y;
assert.ok(height > 0.1 && height < 10, "MHR actor height is not expressed in plausible meters.");
for (const point of scene.path()) assert.ok(point.toArray().every(Number.isFinite));
if (process.argv[3]) {
  const reference = JSON.parse(readFileSync(process.argv[3], "utf8"));
  for (const sample of reference.samples) {
    scene.setTime(sample.seconds);
    assert.ok(scene.camera.position.distanceTo(new THREE.Vector3(...sample.position)) < 0.0001, "Camera position differs from Blender.");
    assert.ok(scene.camera.getWorldDirection(new THREE.Vector3()).distanceTo(new THREE.Vector3(...sample.direction)) < 0.0001, "Camera orientation differs from Blender.");
  }
}
// Reuse one saved actor to validate palette assignment without claiming a
// multi-person reconstruction test or bundling captured assets.
const actorColors = (actor) => {
  const colors = new Map();
  actor.root.traverse((object) => {
    if (!object.isMesh) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      colors.set(material.name.toLowerCase(), material.color.toArray());
    }
  });
  return colors;
};
const paletteScene = new CapturedScene({ ...fixture.descriptor,
  actors: [1, 2, 3, 4].map((actor) => ({ ...fixture.descriptor.actors[0], actor })) },
  [buffers[0], buffers[0], buffers[0], buffers[0], buffers.at(-1)]);
await paletteScene.ready;
const colors = paletteScene.actors.map(actorColors);
for (const color of colors) {
  assert.deepEqual(color.get("body"), colors[0].get("body"), "Actor skin colors differ.");
  assert.notDeepEqual(color.get("body"), color.get("pants"));
  assert.notDeepEqual(color.get("shirt"), color.get("pants"));
}
const hues = colors.map((color) => color.get("shirt"));
assert.ok(hues[0][0] > hues[0][1] && hues[0][1] > hues[0][2], "Actor 1 is not warm orange.");
assert.ok(hues[1][1] > hues[1][0] && hues[1][1] > hues[1][2], "Actor 2 is not green.");
assert.ok(hues[2][2] > hues[2][1] && hues[2][1] > hues[2][0], "Actor 3 is not blue.");
assert.ok(hues[3][0] > hues[3][1] && hues[3][2] > hues[3][1], "Actor 4 is not purple.");
const sparseScene = new CapturedScene({ ...fixture.descriptor,
  actors: [{ ...fixture.descriptor.actors[0], actor: 3 }] }, [buffers[0], buffers.at(-1)]);
await sparseScene.ready;
assert.deepEqual(actorColors(sparseScene.actors[0]).get("shirt"), colors[2].get("shirt"),
  "A missing actor changed the remaining actor's palette.");
sparseScene.dispose();
paletteScene.dispose();
scene.dispose();
console.log("Real FBX loading, meter scale, camera orientation, path sampling, normals, clothing assignments, shared warm skin, four stable actor palettes, and reverse seeking passed.");
