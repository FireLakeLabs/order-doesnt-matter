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
  profileHeight,
} from './ridges/model';

const vertexShader = `
attribute vec2 offset;
attribute vec2 slope;
attribute vec3 ink;
attribute vec4 mark;
attribute float faceDepth;
uniform float now, clock, lookAhead, renderRatio, vertical, cps, gateHeight;
uniform vec2 resolution;
varying vec3 vInk;
varying vec4 vMark;
varying float vTime, vFade, vFace, vDistance, vCycle;
void main(){
  float cycle=position.z;
  float x=position.x;
  if(mark.x>2.5){cycle=floor(now);x=fract(now);}
  float distance=cycle-clock;
  float size=exp(-distance*.19);
  // Passed ridges descend completely below the viewer during the eased slide.
  float base=.74-1.4*size-max(0.,-distance)*1.3;
  float fade=distance<0. ? exp(distance*1.5) : 1./(1.+distance*.13);
  if(distance < -1.05 || distance > lookAhead+.1) fade=0.;
  vec2 p=vec2((x-.5)*1.94*size,base+position.y*vertical*size);
  if(mark.x>2.5)p.y=base+gateHeight*vertical*size+(position.y-.3)*.12*size;
  vec2 delta=offset;
  if(mark.x>.5 && mark.x<1.5){
    vec2 normal=normalize(vec2(-slope.y*vertical*resolution.y,slope.x*1.94*resolution.x));
    delta=normal*offset.y;
  }
  if(mark.x>1.5 && mark.x<2.5 && mark.z<.5){
    float age=(now-mark.y)/max(.001,cps);
    float flare=step(0.,age)*pow(max(0.,1.-age/.22),2.);
    delta*=1.+flare*1.8;
    p.x+=slope.x*faceDepth*2./resolution.x*min(1.,size);
    p.y+=faceDepth*flare*.045*size;
  }
  p+=delta*2./resolution*max(min(1.,size),.8/renderRatio);
  // Every face writes depth, including the light pass. Far ink cannot cross a near face.
  float z=clamp((cycle-floor(now))*.075,-.85,.85)-mark.x*.001;
  gl_Position=vec4(p,z,1.);
  vInk=ink;vMark=mark;vTime=cycle+x;vFade=fade;
  vFace=faceDepth;vDistance=distance;vCycle=cycle;
}`;
const fragmentShader = `
uniform vec3 ground, panel, lineInk, terrainInk, accent, highlight;
uniform float now, cps, lightPass, paper, flatInk;
varying vec3 vInk;
varying vec4 vMark;
varying float vTime, vFade, vFace, vDistance, vCycle;
void main(){
  if(vFade<.001)discard;
  float current=1.-step(.1,abs(vCycle-floor(now)));
  float played=step(vTime,now)*current;
  float gate=exp(-pow((vTime-now)*42.,2.))*current;
  vec3 terrain=mix(terrainInk,accent,vMark.z);
  float foreground=smoothstep(0.,1.,-vDistance);
  if(vMark.x<.5){
    float wash=exp(-max(0.,vFace)*6.);
    vec3 base=mix(ground,panel,.85*vFade);
    float pigment=(.025+wash*(.14+played*.20+gate*.35))*vFade*vMark.w;
    vec3 colour=mix(base,terrain,pigment);
    if(flatInk>.5)colour=mix(ground,mix(panel,terrainInk,paper*.32),(.45+.45*vFade));
    if(paper>.5)colour=mix(ground,terrainInk,.12+.12*vFade+vMark.z*.12);
    colour=mix(colour,ground,foreground*.85);
    if(lightPass>.5)colour=terrain*wash*(played*.17+gate*.38)*vFade*vMark.w;
    gl_FragColor=vec4(colour,1.);
  }else{
    float age=(now-vMark.y)/max(.001,cps);
    float flare=step(0.,age)*pow(max(0.,1.-age/.22),2.);
    vec3 ink=vInk;
    float brightness=1.;
    float emit=0.;
    if(vMark.x<1.5){
      ink=mix(terrain,lineInk,paper*(1.-vMark.z));
      brightness=(paper>.5?1.:(.62+.38*played))*vMark.w;
      emit=(played*.85+gate*.3)*vMark.w;
    }else if(vMark.x<2.5){
      flare=mix(flare,step(vMark.y,now)*(1.-step(vMark.y+1./256.,now)),vMark.z);
      brightness=(.72+.28*max(vFace,flare))*vMark.w;
      ink=mix(ink,highlight,flare*.65*max(.3,vFace));
      emit=(flare+vFace*.18)*vMark.w;
    }else{ink=highlight;emit=1.;}
    float fade=paper>.5 ? 1. : (flatInk>.5 ? max(.75,vFade) : vFade);
    brightness*=1.-foreground*.8;
    if(lightPass>.5)gl_FragColor=vec4(ink*emit*vFade,1.);
    else gl_FragColor=vec4(mix(ground,ink,brightness*fade),1.);
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
      panel: { value: new THREE.Color() },
      lineInk: { value: new THREE.Color() },
      vertical: { value: 0.78 },
      gateHeight: { value: 0 },
      flatInk: { value: 0 },
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
      depthWrite: true,
      depthTest: true,
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
        uniform vec3 ground,panel,accent,highlight,lineInk;
        uniform float lightPass,haze,now,flatInk;uniform vec2 resolution;varying vec2 uvOut;
        void main(){
          if(lightPass>.5){gl_FragColor=vec4(0.,0.,0.,1.);return;}
          vec2 uv=uvOut;
          float glow=exp(-pow((uv.y-.67)*6.,2.));
          vec3 colour=mix(ground,accent,glow*haze);
          vec2 moon=(uv-vec2(.84,.84))*resolution/resolution.y;
          float r=length(moon),cut=length(moon-vec2(.022,.008));
          float edge=max(fwidth(r),.001);
          float crescent=(1.-smoothstep(.049-edge,.049+edge,r))*smoothstep(.045-edge,.045+edge,cut);
          colour=mix(colour,highlight,crescent*.8);
          for(int i=0;i<10;i++){
            float n=float(i)+1.;
            vec2 star=vec2(fract(sin(n*117.3)*43758.5453),.73+fract(sin(n*84.7)*9283.)*.23);
            vec2 p=(uv-star)*resolution;
            float core=1.-smoothstep(.65,1.9,length(p));
            float rays=(1.-smoothstep(.3,.8,min(abs(p.x),abs(p.y))))*(1.-smoothstep(1.,3.,max(abs(p.x),abs(p.y))));
            colour=mix(colour,highlight,max(core,rays*.4)*(.4+.2*sin(now*.2+n)));
          }
          if(flatInk>.5)colour=mix(ground,lineInk,crescent*.7);
          gl_FragColor=vec4(colour,1.);
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
    const profiles = new Map<number, ReturnType<typeof ridgeProfile>>();
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
        marks: number[] = [],
        faces: number[] = [];
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
        face = 0,
      ) {
        positions.push(x, y, cycle);
        offsets.push(dx, dy);
        slopes.push(sx, sy);
        colours.push(colour.r, colour.g, colour.b);
        marks.push(kind, start, tint, strength);
        faces.push(face);
      }
      cycles = [];
      profiles.clear();
      const beaconIds = frame.instruments
        .filter((i) => i.inSection && i.id !== terrain?.instrument)
        .map((i) => i.id);
      for (let cycle = Math.floor(frame.from); cycle < Math.ceil(frame.to); cycle++) {
        cycles.push(cycle);
        const ridge = ridgeProfile(terrain, cycle);
        profiles.set(cycle, ridge);
        // Extend the ground into the corners without inventing any extra note peaks.
        const profile = [
          { x: -0.3, height: 0, count: 0 },
          ...ridge,
          { x: 1.3, height: 0, count: 0 },
        ];
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
            vertex(
              x,
              y,
              cycle,
              0,
              0,
              0,
              0,
              tint,
              strength,
              1,
              0,
              y < 0 ? (x === a.x ? a.height : b.height) + 12 : 0,
            );
          // A ribbon has a real pixel width on WebGL implementations that only support 1px lines.
          for (const [p, dy] of [
            [a, -1.7],
            [b, -1.7],
            [b, 1.7],
            [a, -1.7],
            [b, 1.7],
            [a, 1.7],
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
            tip = base + (spire.height * 1.3) / 0.78;
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
          const width = 4.5;
          // Feet retain the exact onset; fanned tips distinguish simultaneous instruments.
          const fan =
            beaconIds.length > 1
              ? (beaconIds.indexOf(spire.instrument) / (beaconIds.length - 1) - 0.5) * 24
              : 0;
          for (const [y, dx] of [
            [base, -width],
            [base, width],
            [tip, 0],
          ])
            vertex(
              spire.x,
              y,
              cycle,
              dx,
              0,
              2,
              spire.start,
              0,
              strength,
              fan,
              0,
              y === tip ? 1 : 0,
            );
          // Small beacon crown, visible even on a quiet ridge.
          for (const [dx, dy] of [
            [-5, 0],
            [0, 5],
            [5, 0],
            [-5, 0],
            [5, 0],
            [0, -5],
          ])
            vertex(spire.x, tip, cycle, dx, dy, 2, spire.start, 0, strength, fan, 0, 1);
        }
      }
      // The cursor follows the cached crest and still travels across an empty plain.
      for (const [y, dx] of [
        [0, -0.9],
        [0, 0.9],
        [1, 0.9],
        [0, -0.9],
        [1, 0.9],
        [1, -0.9],
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
        vertex(0, 1, 0, dx, dy, 3);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('offset', new THREE.Float32BufferAttribute(offsets, 2));
      geometry.setAttribute('slope', new THREE.Float32BufferAttribute(slopes, 2));
      geometry.setAttribute('ink', new THREE.Float32BufferAttribute(colours, 3));
      geometry.setAttribute('mark', new THREE.Float32BufferAttribute(marks, 4));
      geometry.setAttribute('faceDepth', new THREE.Float32BufferAttribute(faces, 1));
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
        const currentProfile = profiles.get(Math.floor(frame.now));
        uniforms.gateHeight.value = currentProfile
          ? profileHeight(currentProfile, frame.now - Math.floor(frame.now))
          : 0;
        uniforms.now.value = frame.now;
        uniforms.clock.value = ridgeClock(frame.now);
        uniforms.lookAhead.value = frame.lookAhead;
        uniforms.cps.value = frame.cps;
        uniforms.resolution.value.set(frame.width, frame.height);
        uniforms.renderRatio.value = Math.max(0.1, frame.dpr * stage.quality.scale);
        const theme = frame.theme;
        if (lastTheme !== theme || changed) {
          uniforms.ground.value.set(theme.ground);
          uniforms.panel.value.set(theme.panel);
          uniforms.lineInk.value.set(theme.line);
          uniforms.flatInk.value = theme.glow ? 0 : 1;
          uniforms.accent.value.set(theme.accent);
          uniforms.highlight.value.set(theme.text);
          uniforms.terrainInk.value.set(
            frame.instruments.find((i) => i.id === terrain?.instrument)?.colour ?? theme.accent,
          );
          uniforms.paper.value = theme.name === 'riso' ? 1 : 0;
          uniforms.haze.value = theme.glow ? 0.085 : 0;
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
            pose.fade > 0.03 && pose.distance >= -0.05 && pose.distance <= frame.lookAhead;
          el.style.display = visible ? 'block' : 'none';
          if (!visible) continue;
          const { section, boundary } = ridgeSection(frame.sections, cycle);
          const text = `${String(cycle + 1).padStart(2, '0')}${cycle === Math.floor(frame.now) ? ' · now' : ''}${boundary && section ? ` · ${section.name}` : ''}`;
          if (el.textContent !== text) el.textContent = text;
          // Keep the section name readable on the narrow second stage as well.
          const base = 0.74 - 1.4 * pose.scale - Math.max(0, -pose.distance) * 1.3;
          el.style.left = `min(${String((0.5 + 0.49 * pose.scale) * frame.width)}px, calc(100% - 32px - ${String(text.length)}ch))`;
          el.style.transform = `translateY(${String((0.5 - base * 0.5) * frame.height - (boundary ? 22 : 6))}px)`;
          el.style.opacity = boundary ? '1' : String(Math.max(0.7, pose.fade));
          el.style.color = boundary ? theme.accent : theme.muted;
          el.style.font = `${boundary ? '600 14' : '12'}px "${theme.fontMono}"`;
          el.style.background = boundary ? theme.ground : '';
          el.style.padding = boundary ? '5px 9px' : '';
          el.style.border = boundary ? `1px solid ${theme.accent}` : '';
        }
        const section = ridgeSection(frame.sections, Math.floor(frame.now)).section;
        const text = `${section?.name ?? 'open landscape'} · cycle ${String(Math.floor(frame.now) + 1)}\n${frame.to < Math.floor(frame.now) + frame.lookAhead + 1 ? 'asking score ahead…' : ''}`;
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
