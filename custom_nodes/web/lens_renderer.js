import * as THREE from "./vendor/build/three.module.js";
const passes = new WeakMap();
class FisheyePass {
  constructor(renderer) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const face = Math.min(2048, Math.max(256, THREE.MathUtils.ceilPowerOfTwo(Math.max(size.x, size.y) / 1.5)));
    this.target = new THREE.WebGLCubeRenderTarget(face, {
      type: renderer.extensions.has("EXT_color_buffer_float") ? THREE.HalfFloatType : THREE.UnsignedByteType,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    this.cube = new THREE.CubeCamera(0.01, 1000, this.target);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.target.texture },
        halfFov: { value: 1 },
        aspect: { value: 1 },
        rotation: { value: new THREE.Matrix3() },
      },
      vertexShader: "varying vec2 imageUV; void main(){imageUV=uv;gl_Position=vec4(position.xy,0.0,1.0);}",
      fragmentShader: `uniform samplerCube map; uniform float halfFov; uniform float aspect; uniform mat3 rotation; varying vec2 imageUV;
        void main(){vec2 p=(imageUV*2.0-1.0)*vec2(aspect,1.0);float r=length(p);float theta=r*halfFov;
        vec3 ray=r<0.000001?vec3(0.0,0.0,-1.0):vec3(p/r*sin(theta),-cos(theta));
        gl_FragColor=textureCube(map,rotation*ray);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.Camera();
  }
  render(renderer, scene, camera) {
    const viewport = renderer.getViewport(new THREE.Vector4()),
      scissor = renderer.getScissor(new THREE.Vector4()),
      scissorTest = renderer.getScissorTest();
    const target = renderer.getRenderTarget(),
      face = renderer.getActiveCubeFace(),
      mip = renderer.getActiveMipmapLevel();
    this.cube.position.copy(camera.getWorldPosition(new THREE.Vector3()));
    for (const c of this.cube.children) {
      c.near = camera.near;
      c.far = camera.far;
      c.updateProjectionMatrix();
    }
    try {
      renderer.setScissorTest(false);
      this.cube.update(renderer, scene);
    } finally {
      renderer.setRenderTarget(target, face, mip);
      renderer.setViewport(viewport);
      renderer.setScissor(scissor);
      renderer.setScissorTest(scissorTest);
    }
    this.material.uniforms.halfFov.value = THREE.MathUtils.degToRad(camera.fov) / 2;
    this.material.uniforms.aspect.value = camera.aspect;
    this.material.uniforms.rotation.value.setFromMatrix4(
      new THREE.Matrix4().makeRotationFromQuaternion(camera.getWorldQuaternion(new THREE.Quaternion())),
    );
    renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
export function renderCamera(renderer, scene, camera) {
  if (!camera.userData.cartwheelFisheye) return renderer.render(scene, camera);
  let pass = passes.get(renderer);
  if (!pass) {
    pass = new FisheyePass(renderer);
    passes.set(renderer, pass);
  }
  pass.render(renderer, scene, camera);
}
export function disposeLensRenderer(renderer) {
  passes.get(renderer)?.dispose();
  passes.delete(renderer);
}
