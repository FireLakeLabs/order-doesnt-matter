import type { ViewDefinition, ViewFrame, ViewNote, ViewTheme } from './types';
import {
  arcVertices,
  bandLayout,
  ghostBand,
  cycleArcs,
  DENSE_AT,
  occupancy,
  sectionAt,
  sectionEase,
  ringAngle,
  trailDuration,
  TAU,
  TEXTURE_SIZE,
} from './ring/model';

const vertexShader = `
attribute vec3 timing;
attribute vec3 surface;
uniform float radius;
uniform float bandWidth;
uniform float phase;
varying vec3 vTiming;
varying vec3 vSurface;
void main() {
  vTiming = timing;
  vSurface = surface;
  float angle = position.x - phase * 6.28318530718;
  float r = radius + position.y * bandWidth;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(sin(angle)*r, cos(angle)*r, position.z, 1.0);
}`;
const fragmentShader = `
uniform vec3 ink;
uniform vec3 ground;
uniform vec3 highlight;
uniform float now;
uniform float flashDuration;
uniform float trail;
uniform float muted;
uniform float glow;
uniform float ghost;
uniform float dense;
uniform sampler2D occupied;
varying vec3 vTiming;
varying vec3 vSurface;
void main() {
  vec3 timing = vTiming;
  float coverage = 1.0;
  if (dense > 0.5) {
    vec4 texel = texture2D(occupied, vec2(vSurface.x, 0.5));
    coverage = texel.r;
    timing = vec3(texel.g, texel.b, max(0.0, texel.a));
  }
  if (coverage < 0.001) discard;
  if (ghost > 0.5) {
    float ahead = vSurface.x + 1.0 - now;
    if (ahead <= 0.0 || ahead > 0.5) discard;
    gl_FragColor = vec4(mix(ground, ink, 0.24 * muted), coverage * (1.0 - ahead * 1.2));
  } else {
    float age = now - vSurface.x;
    float brightness = age <= 0.0 ? 0.86 : (trail > 0.0 ? mix(0.3, 1.0, max(0.0, 1.0 - age / trail)) : 0.3);
    float sounding = step(timing.x, now) * (1.0 - step(timing.y, now));
    float flash = timing.z * step(timing.x, now) * max(0.0, 1.0 - (now - timing.x) / flashDuration);
    flash *= flash;
    // Short contiguous events retain their complete span, with a bright onset tick.
    float head = 1.0 - smoothstep(0.008, 0.023, vSurface.x - timing.x);
    if (timing.y - timing.x <= 0.2 && timing.z > 0.5) brightness *= mix(0.28, 1.0, head);
    vec3 colour = mix(ground, ink, brightness * muted);
    colour = mix(colour, highlight, flash * 0.85 * muted);
    colour *= 1.0 + glow * muted * (sounding * 0.2 + flash * 0.35);
    float bevel = mix(0.78, 1.0, smoothstep(0.0, 0.10, min(vSurface.y, 1.0-vSurface.y)));
    gl_FragColor = vec4(mix(ground, colour, vSurface.z * bevel), coverage);
  }
  #include <colorspace_fragment>
}`;

const view: ViewDefinition = {
  id: 'ring',
  name: 'Ring',
  tag: 'now',
  async mount(element) {
    // Both the renderer and its postprocessing graph are loaded only on mount.
    const THREE = await import('three');
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] =
      await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'),
        import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'),
        import('three/addons/postprocessing/OutputPass.js'),
      ]);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(1);
    renderer.setSize(1, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = renderer.domElement;
    canvas.dataset.ring = '';
    canvas.style.display = 'block';
    const root = document.createElement('div');
    root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden';
    const centre = document.createElement('div');
    centre.style.cssText =
      'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;pointer-events:none;line-height:1';
    const count = document.createElement('div');
    const section = document.createElement('div');
    section.style.cssText = 'margin-top:10px;white-space:nowrap;letter-spacing:.08em';
    centre.append(count, section);
    root.append(canvas, centre);
    element.append(root);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
    const disc = new THREE.Group();
    scene.add(disc);
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.22, 0.8);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    // A radial gate belongs to the stationary disc, not the rotating score.
    const gateGeometry = new THREE.BoxGeometry(0.006, 0.82, 0.009);
    const gateMaterial = new THREE.MeshBasicMaterial();
    const gate = new THREE.Mesh(gateGeometry, gateMaterial);
    gate.position.set(0, 0.65, 0.035);
    disc.add(gate);
    const beadGeometry = new THREE.SphereGeometry(0.014, 12, 8);
    const bead = new THREE.Mesh(beadGeometry, gateMaterial);
    bead.position.set(0, 1.06, 0.035);
    disc.add(bead);
    const tickGeometry = new THREE.BufferGeometry();
    const ticks: number[] = [];
    for (let i = 0; i < 4; i++) {
      const angle = (i * TAU) / 4;
      ticks.push(
        Math.sin(angle) * 1.025,
        Math.cos(angle) * 1.025,
        0,
        Math.sin(angle) * 1.045,
        Math.cos(angle) * 1.045,
        0,
      );
    }
    tickGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
    const tickMaterial = new THREE.LineBasicMaterial();
    const quarterTicks = new THREE.LineSegments(tickGeometry, tickMaterial);
    disc.add(quarterTicks);
    const full = [{ from: 0, to: 1, start: 0, end: 1, onset: false }];
    const unitGeometry = geometry(full);
    const emptyTexture = new THREE.DataTexture(
      new Float32Array(4),
      1,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    emptyTexture.needsUpdate = true;
    interface Layer {
      mesh: InstanceType<typeof THREE.Mesh>;
      material: InstanceType<typeof THREE.ShaderMaterial>;
      texture?: InstanceType<typeof THREE.DataTexture>;
      ink: InstanceType<typeof THREE.Color>;
      ground: InstanceType<typeof THREE.Color>;
      highlight: InstanceType<typeof THREE.Color>;
    }
    interface RenderBand {
      id: string;
      current: Layer;
      next: Layer;
      track: InstanceType<
        typeof THREE.Mesh<
          InstanceType<typeof THREE.RingGeometry>,
          InstanceType<typeof THREE.MeshBasicMaterial>
        >
      >;
    }
    const bands: RenderBand[] = [];
    let lastNotes: ViewNote[] | undefined;
    let lastCycle = NaN;
    let lastInventory = '';
    let lastTheme: ViewTheme | undefined;
    let width = 0,
      height = 0,
      dpr = 0;
    let layout = new Map<string, ReturnType<typeof bandLayout>[number]>();
    let previous = layout;
    let lastDraw: ViewFrame | undefined;
    let lastDrawInventory = '';

    function geometry(arcs: ReturnType<typeof cycleArcs>) {
      const data = arcVertices(arcs);
      const result = new THREE.BufferGeometry();
      result.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
      result.setAttribute('timing', new THREE.BufferAttribute(data.timing, 3));
      result.setAttribute('surface', new THREE.BufferAttribute(data.surfaces, 3));
      return result;
    }
    function layer(ghost: boolean): Layer {
      const ink = new THREE.Color(),
        ground = new THREE.Color(),
        highlight = new THREE.Color();
      const material = new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          radius: { value: 0 },
          bandWidth: { value: 0 },
          phase: { value: 0 },
          now: { value: 0 },
          ink: { value: ink },
          ground: { value: ground },
          highlight: { value: highlight },
          flashDuration: { value: 0.075 },
          trail: { value: 0.25 },
          muted: { value: 1 },
          glow: { value: 1 },
          ghost: { value: ghost ? 1 : 0 },
          dense: { value: 0 },
          occupied: { value: emptyTexture },
        },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: !ghost,
      });
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
      mesh.frustumCulled = false; // Angles in the vertex buffer are mapped to a disc in the shader.
      disc.add(mesh);
      return { mesh, material, ink, ground, highlight };
    }
    function releaseBand(band: RenderBand) {
      for (const layer of [band.current, band.next]) {
        disc.remove(layer.mesh);
        if (layer.mesh.geometry !== unitGeometry) layer.mesh.geometry.dispose();
        layer.material.dispose();
        layer.texture?.dispose();
      }
      disc.remove(band.track);
      band.track.geometry.dispose();
      band.track.material.dispose();
    }
    function populate(layer: Layer, arcs: ReturnType<typeof cycleArcs>) {
      if (layer.mesh.geometry !== unitGeometry) layer.mesh.geometry.dispose();
      layer.texture?.dispose();
      layer.texture = undefined;
      const dense = arcs.length >= DENSE_AT;
      layer.mesh.geometry = dense ? unitGeometry : geometry(arcs);
      layer.material.uniforms.dense.value = dense ? 1 : 0;
      if (dense) {
        layer.texture = new THREE.DataTexture(
          occupancy(arcs),
          TEXTURE_SIZE,
          1,
          THREE.RGBAFormat,
          THREE.FloatType,
        );
        layer.texture.needsUpdate = true;
      }
      layer.material.uniforms.occupied.value = layer.texture ?? emptyTexture;
    }
    return {
      frame(frame: ViewFrame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const cycle = Math.floor(frame.now);
        const phase = frame.now - cycle;
        const inventory = frame.instruments
          .map((instrument) => `${instrument.id}:${String(instrument.inSection)}`)
          .join('|');
        const drawInventory =
          frame.instruments
            .map(
              (instrument) => `${instrument.id}:${instrument.colour}:${String(instrument.muted)}`,
            )
            .join('|') +
          inventory +
          frame.sections
            .map((section) => `${section.name}:${String(section.from)}:${String(section.to)}`)
            .join('|');
        if (
          lastDraw &&
          lastDraw.now === frame.now &&
          lastDraw.notes === frame.notes &&
          lastDraw.theme === frame.theme &&
          lastDraw.cps === frame.cps &&
          lastDraw.trails === frame.trails &&
          lastDraw.width === frame.width &&
          lastDraw.height === frame.height &&
          lastDraw.dpr === frame.dpr &&
          lastDrawInventory === drawInventory
        )
          return;
        lastDraw = { ...frame };
        lastDrawInventory = drawInventory;
        const resized = width !== frame.width || height !== frame.height || dpr !== frame.dpr;
        if (resized) {
          width = frame.width;
          height = frame.height;
          dpr = frame.dpr;
          renderer.setPixelRatio(dpr);
          renderer.setSize(width, height);
          // UnrealBloomPass downsamples its light buffers; keep the scene at native resolution.
          composer.setPixelRatio(dpr);
          composer.setSize(width, height);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        }
        const scoreChanged = lastNotes !== frame.notes || lastInventory !== inventory;
        const cycleChanged = lastCycle !== cycle;
        if (scoreChanged || cycleChanged) {
          const grouped = new Map<string, ViewNote[]>();
          for (const note of frame.notes) {
            const group = grouped.get(note.instrument) ?? [];
            group.push(note);
            grouped.set(note.instrument, group);
          }
          if (
            bands.length !== frame.instruments.length ||
            bands.some((band, index) => band.id !== frame.instruments[index].id)
          ) {
            bands.forEach(releaseBand);
            bands.length = 0;
            for (const instrument of frame.instruments) {
              const track = new THREE.Mesh(
                new THREE.RingGeometry(0.999, 1.001, 256),
                new THREE.MeshBasicMaterial({
                  transparent: true,
                  opacity: 0.32,
                  side: THREE.DoubleSide,
                  depthWrite: false,
                }),
              );
              disc.add(track);
              bands.push({ id: instrument.id, current: layer(false), next: layer(true), track });
            }
          }
          for (const band of bands) {
            const notes = grouped.get(band.id) ?? [];
            populate(band.current, cycleArcs(notes, cycle));
            populate(band.next, cycleArcs(notes, cycle + 1));
          }
          lastNotes = frame.notes;
          lastCycle = cycle;
          lastInventory = inventory;
        }
        if (scoreChanged || cycleChanged || resized) {
          layout = new Map(bandLayout(frame).map((band) => [band.id, band]));
          previous = new Map(bandLayout(frame, true).map((band) => [band.id, band]));
        }
        const theme = frame.theme;
        if (lastTheme !== theme) {
          renderer.setClearColor(theme.ground);
          scene.background = new THREE.Color(theme.ground);
          gateMaterial.color.set(theme.text);
          tickMaterial.color.set(theme.muted);
          count.style.fontFamily = `"${theme.fontDisplay}", sans-serif`;
          section.style.fontFamily = `"${theme.fontMono}", monospace`;
          count.style.color = theme.text;
          section.style.color = theme.muted;
          lastTheme = theme;
        }
        const size = Math.min(width, height);
        if (resized) {
          count.style.fontSize = `${String(size * 0.11)}px`;
          section.style.fontSize = `${String(Math.max(9, size * 0.018))}px`;
        }
        const cycleText = String(cycle + 1);
        if (count.textContent !== cycleText) count.textContent = cycleText;
        const sectionText = sectionAt(frame)?.name ?? 'cycle';
        if (section.textContent !== sectionText) section.textContent = sectionText;
        const easing = sectionEase(frame);
        camera.position.set(
          0,
          Math.sin(frame.now / 48) * 0.08,
          (1 / (0.84 * Math.tan((35 * Math.PI) / 360))) * Math.max(1, height / width),
        );
        camera.lookAt(0, 0, 0);
        quarterTicks.rotation.z = -ringAngle(cycle, frame.now);
        disc.rotation.x = ((18 + Math.sin(frame.now / 64) * 2) * Math.PI) / 180;
        const easedBands = [...layout.values()].map((target) => {
          const before = previous.get(target.id) ?? target;
          return {
            ...target,
            radius: THREE.MathUtils.lerp(before.radius, target.radius, easing),
            width: THREE.MathUtils.lerp(before.width, target.width, easing),
          };
        });
        for (let index = 0; index < bands.length; index++) {
          const band = bands[index];
          const instrument = frame.instruments[index];
          const target = easedBands.find((pose) => pose.id === band.id);
          if (!target) continue;
          const { radius, width: thickness } = target;
          const ghost = ghostBand(target, easedBands, size * 0.42);
          band.track.scale.set(radius, radius, 1);
          band.track.material.color.set(target.resting ? theme.muted : theme.line);
          band.track.material.opacity = target.resting ? 0.32 : 0.55;
          band.current.mesh.visible = !target.resting;
          band.next.mesh.visible = ghost.width > 0;
          for (const layer of [band.current, band.next]) {
            const u = layer.material.uniforms;
            u.radius.value = layer === band.next ? ghost.radius : radius;
            u.bandWidth.value = layer === band.next ? ghost.width : thickness;
            u.phase.value = phase;
            u.now.value = phase;
            u.flashDuration.value = Math.max(0.00001, frame.cps * 0.15);
            u.trail.value = trailDuration(frame.trails);
            u.muted.value = instrument.muted ? 0.23 : 1;
            u.glow.value = theme.glow ? 1 : 0;
            layer.ink.set(instrument.colour);
            layer.ground.set(theme.ground);
            layer.highlight.set(theme.text);
          }
        }
        if (theme.glow) {
          // The composer renders the scene and adds the downsampled light buffers.
          composer.render();
        } else renderer.render(scene, camera);
      },
      dispose() {
        bands.forEach(releaseBand);
        unitGeometry.dispose();
        emptyTexture.dispose();
        gateGeometry.dispose();
        beadGeometry.dispose();
        gateMaterial.dispose();
        tickGeometry.dispose();
        tickMaterial.dispose();
        for (const pass of composer.passes) pass.dispose();
        composer.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        root.remove();
      },
    };
  },
};
export default view;
