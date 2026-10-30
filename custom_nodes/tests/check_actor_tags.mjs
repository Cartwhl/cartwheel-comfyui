// Offline projection/order checks; actual layout is also verified in ComfyUI.
import assert from "node:assert/strict";
import * as THREE from "../web/vendor/build/three.module.js";
import { ActorTags } from "../web/actor_tags.js";

const element = () => ({
  style: {}, hidden: false, children: [], offsetWidth: 56, offsetHeight: 22,
  append(...children) { this.children.push(...children); },
  replaceChildren() { this.children = []; },
});
globalThis.document = { createElement: element };
const tags = new ActorTags(element());
const actors = [0, 1, 3, 2].map((z, index) => {
  const root = new THREE.Group();
  root.position.z = z;
  const head = new THREE.Bone();
  head.name = "c_head";
  head.position.y = 1.6;
  root.add(head);
  return { root, number: index + 1, head };
});
tags.load({ actors });
assert.deepEqual(tags.entries.map(({ tag }) => tag.textContent), ["Actor 1", "Actor 2", "Actor 3", "Actor 4"]);
const camera = new THREE.PerspectiveCamera(45, 2, 0.01, 100);
camera.position.set(0, 1.6, 10);
camera.lookAt(0, 1.6, 0);
tags.render(camera, 800, 400);
const order = () => tags.entries.map(({ tag }) => Number(tag.style.zIndex));
assert.ok(order()[2] > Math.max(...order().filter((_, index) => index !== 2)), "The closest actor (3) is not in front.");
const rects = tags.entries.map(({ tag }) => ({
  left: parseFloat(tag.style.left) - tag.offsetWidth / 2,
  right: parseFloat(tag.style.left) + tag.offsetWidth / 2,
  top: parseFloat(tag.style.top) - tag.offsetHeight,
  bottom: parseFloat(tag.style.top),
}));
assert.ok(rects.some((a, i) => rects.some((b, j) => i !== j && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)), "Overlapping head labels were unexpectedly separated.");
const actorOnePosition = { ...tags.entries[0].tag.style };
actors[2].head.position.x = 1;
tags.render(camera, 800, 400);
assert.equal(tags.entries[0].tag.style.left, actorOnePosition.left, "Another actor moved this tag horizontally.");
assert.equal(tags.entries[0].tag.style.top, actorOnePosition.top, "Another actor moved this tag vertically.");
actors[2].head.position.x = 0;
tags.render(camera, 800, 400);
for (const { tag, head } of tags.entries) {
  const anchor = head.getWorldPosition(new THREE.Vector3());
  anchor.y += 0.3;
  anchor.project(camera);
  assert.ok(Math.abs(parseFloat(tag.style.left) - (anchor.x * 0.5 + 0.5) * 800) < 1e-7, "Tag shifted away from its head anchor.");
  assert.ok(Math.abs(parseFloat(tag.style.top) - (0.5 - anchor.y * 0.5) * 400) < 1e-7, "Tag shifted away from its fixed height above the head.");
}
const previousLeft = tags.entries[2].tag.style.left;
actors[2].head.position.x = 0.5;
tags.render(camera, 800, 400);
assert.notEqual(tags.entries[2].tag.style.left, previousLeft, "The tag did not follow its animated head.");
camera.position.set(0, 1.6, -10);
camera.lookAt(0, 1.6, 0);
tags.render(camera, 800, 400);
assert.ok(order()[0] > Math.max(...order().slice(1)), "Orbiting did not bring the newly closest actor to the front.");
tags.render(camera, 800, 400, false);
assert.equal(tags.layer.hidden, true, "The labels toggle did not hide the overlay.");
tags.render(camera, 0, 400, true);
assert.equal(tags.layer.hidden, true, "Tags appear in camera-only mode.");
tags.load({ actors: [actors[2]] });
assert.equal(tags.entries[0].tag.textContent, "Actor 3", "Missing actors changed the remaining tag's number.");
console.log("Actor tag numbering, head tracking, fixed head anchors, permitted overlap, inspection-camera depth priority, toggle, and camera-only hiding passed.");
