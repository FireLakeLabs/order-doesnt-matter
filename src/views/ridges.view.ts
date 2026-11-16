import type { ViewDefinition, ViewFrame } from './types';
import { createThreeStage } from './shared/three-stage';
import {
  BINS,
  ridgeClock,
  ridgePose,
  ridgeProfile,
  ridgeSection,
  ridgeSpires,
  terrainDriver,
} from './ridges/model';

const vertexShader = `
attribute vec2 offset;
attribute vec2 slope;
attribute vec3 ink;
attribute vec4 mark;
uniform float now, clock, lookAhead, renderRatio;
uniform vec2 resolution;
varying vec3 vInk;
varying vec4 vMark;
varying float vTime, vFade;
void main(){
  float cycle=position.z;
  float x=position.x;
  if(mark.x>2.5){cycle=floor(now);x=fract(now);}
  float distance=cycle-clock;
  float size=exp(-distance*.19);
  float base=.82-1.3*size;
  float fade=distance<0. ? exp(distance*2.4) : clamp((lookAhead+1.5-distance)/1.5,0.,1.)/(1.+distance*.24);
  if(distance < -2.5 || distance > lookAhead+1.5) fade=0.;
  vec2 p=vec2((x-.5)*1.66*size,base+position.y*.30*size);
  // Keep continuous ink when the shared governor lowers framebuffer resolution.
  vec2 delta=offset;
  if(mark.x>.5 && mark.x<1.5){
    vec2 normal=normalize(vec2(-slope.y*.30*resolution.y,slope.x*1.66*resolution.x));
    delta=normal*offset.y;
  }
  p+=delta*2./resolution*max(min(1.,size),.8/renderRatio);
  float z=clamp(distance*.045,-.8,.8)-mark.x*.001;
  gl_Position=vec4(p,z,1.);
  vInk=ink;vMark=mark;vTime=cycle+x;vFade=fade;
}`;
const fragmentShader = `
uniform vec3 ground, terrainInk, accent, highlight;
uniform float now, cps, lightPass, paper;
varying vec3 vInk;
varying vec4 vMark;
varying float vTime, vFade;
void main(){
  if(vFade<.001)discard;
  if(vMark.x<.5){
    // Ground stays opaque in both passes: nearer mountains also occlude distant bloom.
    gl_FragColor=vec4(lightPass>.5 ? vec3(0.) : ground,1.);
  }else{
    float age=(now-vMark.y)/max(.001,cps);
    float flare=step(0.,age)*pow(max(0.,1.-age/.20),2.);
    vec3 ink=vInk;
    float brightness=1.;
    float emit=0.;
    if(vMark.x<1.5){
      ink=mix(terrainInk,accent,vMark.z);
      float played=step(vTime,now);
      brightness=mix(mix(.38,.75,paper),1.,played)*vMark.w;
      emit=played*.75*vMark.w;
    }else if(vMark.x<2.5){
      flare=mix(flare,step(vMark.y,now)*(1.-step(vMark.y+1./256.,now)),vMark.z);
      brightness=(.65+.35*flare)*vMark.w;
      ink=mix(ink,highlight,flare*.55);
      emit=flare*vMark.w;
    }else{ink=highlight;emit=1.;}
    if(lightPass>.5){
      gl_FragColor=vec4(ink*emit*vFade,1.);
    }else{
      gl_FragColor=vec4(mix(ground,ink,brightness*vFade),1.);
    }
  }
  #include <colorspace_fragment>
}`;

const view: ViewDefinition = {
  id: 'ridges',
  name: 'Ridges',
  tag: 'landscape',
  async mount(element) {
    const stage = await createThreeStage(element, 'ridges');
    const { THREE, scene, root } = stage;
    const uniforms = {
      now: { value: 0 },
      clock: { value: 0 },
      lookAhead: { value: 4 },
      cps: { value: 1 },
      resolution: { value: new THREE.Vector2(1, 1) },
      ground: { value: new THREE.Color() },
      terrainInk: { value: new THREE.Color() },
      accent: { value: new THREE.Color() },
      highlight: { value: new THREE.Color() },
      lightPass: { value: 0 },
      paper: { value: 0 },
      haze: { value: 0 },
      renderRatio: { value: 1 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
    mesh.frustumCulled = false;
    scene.add(mesh);
    const skyGeometry = new THREE.PlaneGeometry(2, 2);
    const skyMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader:
        'varying vec2 uvOut;void main(){uvOut=uv;gl_Position=vec4(position.xy,.99,1.);}',
      fragmentShader: `
        uniform vec3 ground,accent;uniform float lightPass,haze;varying vec2 uvOut;
        void main(){
          float glow=exp(-pow((uvOut.y-.82)*10.,2.))*exp(-pow((uvOut.x-.5)*2.,2.));
          gl_FragColor=vec4(lightPass>.5?vec3(0.):mix(ground,accent,glow*haze*smoothstep(.55,.88,uvOut.y)),1.);
          #include <colorspace_fragment>
        }`,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    scene.add(sky);
    function label(css: string) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;pointer-events:none;${css}`;
      root.append(el);
      return el;
    }
    const title = label('left:26px;top:22px;letter-spacing:.03em');
    title.textContent = 'Ridges';
    const caption = label('left:26px;top:54px;line-height:1.7');
    const footer = label('left:26px;bottom:22px;line-height:1.6');
    const labels = new Map<number, HTMLDivElement>();
    let notes: ViewFrame['notes'] | undefined,
      inventory = '',
      lastTheme: ViewFrame['theme'] | undefined;
    let terrain: ReturnType<typeof terrainDriver>;
    let last: ViewFrame | undefined;
    let cycles: number[] = [];
    function build(frame: ViewFrame) {
      terrain = terrainDriver(frame);
      const positions: number[] = [],
        offsets: number[] = [],
        slopes: number[] = [],
        colours: number[] = [],
        marks: number[] = [];
      const instruments = new Map(frame.instruments.map((i) => [i.id, i]));
      const colour = new THREE.Color();
      function vertex(
        x: number,
        y: number,
        cycle: number,
        dx: number,
        dy: number,
        kind: number,
        start = 0,
        tint = 0,
        strength = 1,
        sx = 1,
        sy = 0,
      ) {
        positions.push(x, y, cycle);
        offsets.push(dx, dy);
        slopes.push(sx, sy);
        colours.push(colour.r, colour.g, colour.b);
        marks.push(kind, start, tint, strength);
      }
      cycles = [];
      for (let cycle = Math.floor(frame.from); cycle < Math.ceil(frame.to); cycle++) {
        cycles.push(cycle);
        const profile = ridgeProfile(terrain, cycle);
        const section = ridgeSection(frame.sections, cycle);
        const tint = section.boundary ? 0.85 : section.index % 2 === 1 ? 0.22 : 0;
        const strength = instruments.get(terrain?.instrument ?? '')?.muted ? 0.22 : 1;
        for (let i = 1; i < profile.length; i++) {
          const a = profile[i - 1],
            b = profile[i];
          // Fill down past the viewport, leaving no line from the next ridge visible through it.
          for (const [x, y] of [
            [a.x, -12],
            [b.x, -12],
            [b.x, b.height],
            [a.x, -12],
            [b.x, b.height],
            [a.x, a.height],
          ])
            vertex(x, y, cycle, 0, 0, 0);
          // A ribbon has a real pixel width on WebGL implementations that only support 1px lines.
          for (const [p, dy] of [
            [a, -1.1],
            [b, -1.1],
            [b, 1.1],
            [a, -1.1],
            [b, 1.1],
            [a, 1.1],
          ] as const)
            vertex(
              p.x,
              p.height,
              cycle,
              0,
              dy,
              1,
              0,
              tint,
              strength,
              b.x - a.x,
              b.height - a.height,
            );
        }
        for (const spire of ridgeSpires(frame, terrain, cycle, profile)) {
          const instrument = instruments.get(spire.instrument);
          if (!instrument) continue;
          colour.set(instrument.colour);
          const strength = instrument.muted ? 0.2 : 1;
          const base = spire.base,
            tip = base + spire.height / 0.3;
          if (spire.dense) {
            // Floods become joined occupancy bands, not a subpixel forest of spires.
            const left = spire.x - 0.5 / BINS,
              right = spire.x + 0.5 / BINS;
            const top = base + (tip - base) * 0.4;
            for (const [x, y] of [
              [left, base],
              [right, base],
              [right, top],
              [left, base],
              [right, top],
              [left, top],
            ])
              vertex(x, y, cycle, 0, 0, 2, spire.start, 1, strength);
            continue;
          }
          const width = 0.8;
          for (const [y, dx] of [
            [base, -width],
            [base, width],
            [tip, 0],
          ])
            vertex(spire.x, y, cycle, dx, 0, 2, spire.start, 0, strength);
          // Small beacon crown, visible even on a quiet ridge.
          for (const [dx, dy] of [
            [-2, 0],
            [0, 2],
            [2, 0],
            [-2, 0],
            [2, 0],
            [0, -2],
          ])
            vertex(spire.x, tip, cycle, dx, dy, 2, spire.start, 0, strength);
        }
      }
      // The gate is generated in the shader from now, independently of note occupancy.
      for (const [y, dx] of [
        [-0.08, -0.7],
        [-0.08, 0.7],
        [1.65, 0.7],
        [-0.08, -0.7],
        [1.65, 0.7],
        [1.65, -0.7],
      ])
        vertex(0, y, 0, dx, 0, 3);
      for (const [dx, dy] of [
        [-3, 0],
        [0, 3],
        [3, 0],
        [-3, 0],
        [3, 0],
        [0, -3],
      ])
        vertex(0, 1.65, 0, dx, dy, 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('offset', new THREE.Float32BufferAttribute(offsets, 2));
      geometry.setAttribute('slope', new THREE.Float32BufferAttribute(slopes, 2));
      geometry.setAttribute('ink', new THREE.Float32BufferAttribute(colours, 3));
      geometry.setAttribute('mark', new THREE.Float32BufferAttribute(marks, 4));
      mesh.geometry.dispose();
      mesh.geometry = geometry;
      for (const el of labels.values()) el.remove();
      labels.clear();
      for (const cycle of cycles)
        labels.set(cycle, label('left:0;top:0;white-space:nowrap;transform-origin:0 50%'));
    }
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const key =
          frame.instruments
            .map(
              (i) =>
                `${i.id}:${i.name}:${String(i.index)}:${i.colour}:${String(i.inSection)}:${String(i.muted)}`,
            )
            .join('|') +
          frame.sections.map((s) => `${s.name}:${String(s.from)}:${String(s.to)}`).join('|') +
          `:${String(frame.from)}:${String(frame.to)}`;
        if (
          last?.now === frame.now &&
          last.notes === frame.notes &&
          last.theme === frame.theme &&
          key === inventory &&
          last.width === frame.width &&
          last.height === frame.height &&
          last.dpr === frame.dpr &&
          last.lookAhead === frame.lookAhead &&
          last.cps === frame.cps &&
          last.playing === frame.playing
        )
          return;
        last = { ...frame };
        stage.resize(frame);
        const changed = notes !== frame.notes || key !== inventory;
        if (changed) {
          build(frame);
          notes = frame.notes;
          inventory = key;
        }
        uniforms.now.value = frame.now;
        uniforms.clock.value = ridgeClock(frame.now);
        uniforms.lookAhead.value = frame.lookAhead;
        uniforms.cps.value = frame.cps;
        uniforms.resolution.value.set(frame.width, frame.height);
        uniforms.renderRatio.value = Math.max(0.1, frame.dpr * stage.quality.scale);
        const theme = frame.theme;
        if (lastTheme !== theme || changed) {
          uniforms.ground.value.set(theme.ground);
          uniforms.accent.value.set(theme.accent);
          uniforms.highlight.value.set(theme.text);
          uniforms.terrainInk.value.set(
            frame.instruments.find((i) => i.id === terrain?.instrument)?.colour ?? theme.accent,
          );
          uniforms.paper.value = theme.glow ? 0 : 1;
          uniforms.haze.value = theme.glow ? 0.014 : 0;
          title.style.font = `500 23px "${theme.fontDisplay}"`;
          title.style.color = theme.text;
          for (const el of [caption, footer, ...labels.values()]) {
            el.style.font = `11px "${theme.fontMono}"`;
            el.style.color = theme.muted;
          }
          caption.textContent = terrain
            ? `terrain: ${terrain.name} ${terrain.setting}`
            : 'terrain: resting plain';
          lastTheme = theme;
        }
        for (const [cycle, el] of labels) {
          const pose = ridgePose(cycle, frame.now, frame.lookAhead);
          const visible =
            pose.fade > 0.03 &&
            pose.y > -0.95 &&
            pose.distance >= -0.2 &&
            pose.distance <= frame.lookAhead;
          el.style.display = visible ? 'block' : 'none';
          if (!visible) continue;
          const { section, boundary } = ridgeSection(frame.sections, cycle);
          const text = `${String(cycle + 1).padStart(2, '0')}${cycle === Math.floor(frame.now) ? ' · now' : ''}${boundary && section ? ` · ${section.name}` : ''}`;
          if (el.textContent !== text) el.textContent = text;
          // Keep the section name readable on the narrow second stage as well.
          el.style.left = `min(${String((0.5 + 0.433 * pose.scale) * frame.width)}px, calc(100% - 16px - ${String(text.length)}ch))`;
          el.style.transform = `translateY(${String((0.5 - pose.y * 0.5) * frame.height - 6)}px) scale(${String(0.7 + pose.scale * 0.3)})`;
          el.style.opacity = String(pose.fade);
          el.style.color = boundary ? theme.accent : theme.muted;
        }
        const section = ridgeSection(frame.sections, Math.floor(frame.now)).section;
        const text = `${section?.name ?? 'open landscape'} · cycle ${String(Math.floor(frame.now) + 1)}\n${frame.to < Math.floor(frame.now) + frame.lookAhead + 1 ? 'asking score ahead…' : 'one note, one peak · beacons mark onsets'}`;
        footer.style.whiteSpace = 'pre-line';
        if (footer.textContent !== text) footer.textContent = text;
        stage.render(frame, (enabled) => {
          uniforms.lightPass.value = enabled ? 1 : 0;
        });
      },
      dispose() {
        mesh.geometry.dispose();
        material.dispose();
        skyGeometry.dispose();
        skyMaterial.dispose();
        stage.dispose();
      },
    };
  },
};
export default view;
