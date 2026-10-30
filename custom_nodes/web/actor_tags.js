import * as THREE from "./vendor/build/three.module.js";

// DOM-only labels: they cannot enter either WebGL camera render or VIDEO output.
export class ActorTags {
  constructor(viewport) {
    this.layer = document.createElement("div");
    this.layer.className = "cw-actor-tags";
    this.layer.hidden = true;
    viewport.append(this.layer);
    this.entries = [];
    this.point = new THREE.Vector3();
    this.cameraPoint = new THREE.Vector3();
  }

  load(capture) {
    this.layer.replaceChildren();
    this.entries = capture.actors.map((actor, index) => {
      const tag = document.createElement("span");
      tag.className = "cw-actor-tag";
      tag.textContent = `Actor ${actor.number ?? index + 1}`;
      this.layer.append(tag);
      let head;
      actor.root.traverse((object) => {
        if (!head && object.isBone && /(^|[:_])head$/i.test(object.name)) head = object;
      });
      // Fallback for an unfamiliar rig: use the initial mesh's top center.
      let local;
      if (!head) {
        const bounds = new THREE.Box3().setFromObject(actor.root);
        local = actor.root.worldToLocal(new THREE.Vector3(
          (bounds.min.x + bounds.max.x) / 2, bounds.max.y, (bounds.min.z + bounds.max.z) / 2));
      }
      return { tag, actor, head, local };
    });
  }

  render(camera, width, height, enabled = true) {
    this.layer.hidden = width <= 0 || !enabled;
    if (this.layer.hidden) return;
    this.layer.style.width = `${width}px`;
    camera.updateMatrixWorld();
    const visible = [];
    for (const { tag, actor, head, local } of this.entries) {
      if (head) head.getWorldPosition(this.point);
      else actor.root.localToWorld(this.point.copy(local));
      this.point.y += head ? 0.3 : 0.12;
      const depth = -this.cameraPoint.copy(this.point).applyMatrix4(camera.matrixWorldInverse).z;
      this.point.project(camera);
      const { x, y, z } = this.point;
      tag.hidden = depth <= 0 || ![x, y, z].every(Number.isFinite) || z < -1 || z > 1 || Math.abs(x) > 1 || Math.abs(y) > 1;
      if (tag.hidden) continue;
      visible.push({ tag, depth, x: (x * 0.5 + 0.5) * width, y: (0.5 - y * 0.5) * height });
    }
    // Fixed head anchors may overlap. Nearer actors draw over farther actors,
    // using the inspection camera's depth rather than the captured camera.
    visible.sort((a, b) => a.depth - b.depth);
    for (const [index, { tag, x, y }] of visible.entries()) {
      tag.style.zIndex = String(visible.length - index);
      tag.style.left = `${x}px`;
      tag.style.top = `${y}px`;
    }
  }
}
