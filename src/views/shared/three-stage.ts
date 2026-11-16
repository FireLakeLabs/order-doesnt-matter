import { createQualityGovernor } from './quality';
import type { ViewFrame } from '../types';

/** Lazy renderer and selective bloom shared by the three.js views. Scene resources
 * belong to the view; this stage owns the renderer and postprocessing graph. */
export async function createThreeStage(element: HTMLElement, id: string) {
  const THREE = await import('three');
  const [{ EffectComposer }, { RenderPass }, { ShaderPass }, { FullScreenQuad }, { OutputPass }] =
    await Promise.all([
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/ShaderPass.js'),
      import('three/addons/postprocessing/Pass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
    ]);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(1, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const governor = createQualityGovernor();
  const canvas = renderer.domElement;
  canvas.dataset[id] = '';
  canvas.style.display = 'block';
  const root = document.createElement('div');
  root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden';
  root.append(canvas);
  element.append(root);
  const scene = new THREE.Scene();
  const black = new THREE.Color(0);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 10000);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Selective, finite-support bloom: only sounding notes emit. Its kernel reaches
  // about 5% of the ring radius diagonally; max composition preserves the score ink.
  const lightA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const lightB = lightA.clone();
  const blurStep = new THREE.Vector2();
  const blurMaterial = new THREE.ShaderMaterial({
    uniforms: { source: { value: lightA.texture }, stepSize: { value: blurStep } },
    vertexShader: 'varying vec2 uvOut; void main(){uvOut=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: `
        uniform sampler2D source; uniform vec2 stepSize; varying vec2 uvOut;
        void main(){
          vec3 light=vec3(0.);
          float total=0.;
          for(int i=-4;i<=4;i++){
            float weight=exp(-float(i*i)/5.0);
            light+=texture2D(source,uvOut+float(i)*stepSize).rgb*weight;
            total+=weight;
          }
          gl_FragColor=vec4(light/total,1.);
        }`,
  });
  const blurQuad = new FullScreenQuad(blurMaterial);
  const bloom = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null }, light: { value: lightA.texture } },
      vertexShader:
        'varying vec2 uvOut; void main(){uvOut=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `
        uniform sampler2D tDiffuse; uniform sampler2D light; varying vec2 uvOut;
        void main(){
          vec4 base=texture2D(tDiffuse,uvOut);
          gl_FragColor=vec4(max(base.rgb,texture2D(light,uvOut).rgb*0.65),base.a);
        }`,
    }),
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  let width = 0,
    height = 0,
    dpr = 0,
    lost = false,
    disposed = false;
  let appliedScale = 0,
    previousStart = 0,
    previousPlaying = false;
  function sizeRenderer(cssResized = false) {
    const ratio = dpr * governor.quality.scale;
    renderer.setPixelRatio(ratio);
    if (cssResized) renderer.setSize(width, height);
    lightA.setSize(Math.ceil((width * ratio) / 2), Math.ceil((height * ratio) / 2));
    lightB.setSize(Math.ceil((width * ratio) / 2), Math.ceil((height * ratio) / 2));
    composer.setPixelRatio(ratio);
    if (cssResized) composer.setSize(width, height);
    appliedScale = governor.quality.scale;
    canvas.dataset.renderScale = String(appliedScale);
  }
  const fallback = document.createElement('div');
  fallback.setAttribute('role', 'alert');
  fallback.style.cssText =
    'position:absolute;inset:0;display:grid;place-content:center;padding:24px;text-align:center';
  fallback.textContent = '3D drawing interrupted. Switch to another view, then return to restart.';
  const contextLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    canvas.style.visibility = 'hidden';
    root.append(fallback);
  };
  canvas.addEventListener('webglcontextlost', contextLost);
  return {
    THREE,
    renderer,
    canvas,
    root,
    scene,
    camera,
    get quality() {
      return governor.quality;
    },
    resize(frame: ViewFrame) {
      if (disposed || frame.width <= 0 || frame.height <= 0) return false;
      const resized = width !== frame.width || height !== frame.height || dpr !== frame.dpr;
      if (resized) {
        width = frame.width;
        height = frame.height;
        dpr = frame.dpr;
        sizeRenderer(true);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      }
      renderer.setClearColor(frame.theme.ground);
      if (!(scene.background instanceof THREE.Color)) scene.background = new THREE.Color();
      scene.background.set(frame.theme.ground);
      fallback.style.background = frame.theme.ground;
      fallback.style.color = frame.theme.text;
      fallback.style.fontFamily = frame.theme.fontMono;
      return resized;
    },
    render(frame: ViewFrame, emission: (enabled: boolean) => void) {
      if (lost || disposed) return;
      const started = performance.now();
      if (appliedScale !== governor.quality.scale) sizeRenderer();
      const theme = frame.theme;
      const size = Math.min(width, height);
      const glow = theme.glow && governor.quality.bloom;
      if (canvas.dataset.bloom !== String(glow)) canvas.dataset.bloom = String(glow);
      if (glow) {
        const background = scene.background;
        scene.background = black;
        emission(true);
        renderer.setRenderTarget(lightA);
        renderer.render(scene, camera);
        // Two bounded Gaussian passes, with a diagonal support of 5% radius.
        const support = size * 0.42 * 0.035;
        blurMaterial.uniforms.source.value = lightA.texture;
        blurStep.set(support / (4 * width), 0);
        renderer.setRenderTarget(lightB);
        blurQuad.render(renderer);
        blurMaterial.uniforms.source.value = lightB.texture;
        blurStep.set(0, support / (4 * height));
        renderer.setRenderTarget(lightA);
        blurQuad.render(renderer);
        renderer.setRenderTarget(null);
        scene.background = background;
        emission(false);
        composer.render();
      } else renderer.render(scene, camera);
      // Submission alone misses GPU/compositor backpressure. Continuous playback
      // cadence includes it; paused/manual draws use only their own CPU cost so
      // a long pause is not mistaken for an expensive frame.
      const cost = performance.now() - started;
      const interval =
        previousStart && previousPlaying && frame.playing ? started - previousStart : 0;
      governor.observe(Math.max(cost, interval), interval || cost);
      previousStart = started;
      previousPlaying = frame.playing;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('webglcontextlost', contextLost);
      for (const pass of composer.passes) pass.dispose();
      composer.dispose();
      lightA.dispose();
      lightB.dispose();
      blurMaterial.dispose();
      blurQuad.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
    },
  };
}
export type ThreeStage = Awaited<ReturnType<typeof createThreeStage>>;
