# Viewer dependencies

Pinned Three.js **0.180.0** modules from the official [npm archive](https://registry.npmjs.org/three/-/three-0.180.0.tgz). The FBX loader includes fflate **0.8.2**. Both use the MIT license; original notices are retained in `LICENSE`, `LICENSE.fflate`, and the source headers.

Only the Three.js build, FBX and GLTF loaders, OrbitControls, TransformControls, and their direct dependencies are included. The example-module imports of `three` are rewritten to the bundled build's relative path. The FBX loader also preserves the source model ID on each animation track so whole-scene imports with repeated bone names can bind tracks to the correct actor. Other vendor source is unchanged. There are no CDN or runtime package-install requests.
