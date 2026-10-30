// Some GLB exporters provide a constant placeholder normal for a curved mesh.
// Keep real normals; rebuild absent/constant ones from that primitive's faces.
export function ensureNormals(geometry) {
  const normal = geometry.getAttribute('normal');
  let rebuild = !normal;
  if (normal?.count) {
    rebuild = true;
    for (let i = 1; i < normal.count; i++) {
      if (Math.abs(normal.getX(i)-normal.getX(0)) + Math.abs(normal.getY(i)-normal.getY(0)) + Math.abs(normal.getZ(i)-normal.getZ(0)) > 1e-6) {
        rebuild = false;
        break;
      }
    }
  }
  if (rebuild) {
    // GLB primitives may share attributes. Never overwrite another primitive's normals.
    geometry.deleteAttribute('normal');
    geometry.computeVertexNormals();
  }
}
