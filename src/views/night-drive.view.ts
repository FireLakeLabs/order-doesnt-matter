import type { ViewDefinition, ViewFrame } from './types';
import { createThreeStage } from './shared/three-stage';
import {
  hillDriver,
  hillProfile,
  roadMarks,
  roadVoices,
  sectionRoad,
  roadZ,
  ROAD_LENGTH,
  PLAYHEAD_Z,
} from './night-drive/model';
import type { RoadVoice } from './night-drive/model';

const timedVertex = `
attribute vec3 timing;
attribute float shade, pitchedMark;
uniform float now, windowSize;
varying vec3 vTiming;
varying float vShade, vTime, vPitched;
void main(){
  vTiming=timing; vShade=shade; vTime=position.z; vPitched=pitchedMark;
  vec3 p=vec3(position.xy,${String(PLAYHEAD_Z)}.0-(position.z-now)*${String(ROAD_LENGTH)}.0/windowSize);
  gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
}`;
const timedFragment = `
uniform vec3 ink, ground, highlight, panel;
uniform float now, cps, windowSize, muted, lightPass, dense, trails, baseInk;
varying vec3 vTiming;
varying float vShade, vTime, vPitched;
void main(){
  if(vTime>now+windowSize || vTime<now-.3) discard;
  float age=(now-vTiming.x)/max(.001,cps);
  float hit=vTiming.z*step(0.,age)*max(0.,1.-age/.15);
  float held=vPitched*step(vTiming.x,now)*(1.-step(vTiming.y,now));
  float occupancy=dense*step(vTiming.x,now)*(1.-step(vTiming.y,now));
  float lit=max(max(hit,held),occupancy);
  float fade=1.-smoothstep(windowSize*.8,windowSize,vTime-now);
  float passed=1.-smoothstep(.03,.12+trails*.08,now-vTiming.y);
  vec3 colour=mix(ground,ink,(baseInk+(1.-baseInk)*lit)*muted*vShade);
  colour=mix(colour,highlight,hit*.38*muted*vShade);
  if(vShade<.6)colour=mix(panel,ink,lit*.15*muted);
  if(lightPass>.5){if(lit<.01)discard;colour=ink*lit*muted*vShade;}
  gl_FragColor=vec4(colour,fade*passed);
  #include <colorspace_fragment>
}`;
const planeVertex = `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const roadFragment = `
varying vec2 vUv;
uniform vec3 ground, lineInk, edgeInk, textInk;
uniform float now, windowSize, lightPass;
float stroke(float v,float width){return 1.-smoothstep(width,width+fwidth(v),abs(v));}
void main(){
  if(lightPass>.5) discard;
  float x=(vUv.x-.5)*220.;
  float distance=vUv.y*160.-8.;
  float time=now+(distance-1.)*windowSize/${String(ROAD_LENGTH)}.;
  float quarter=abs(fract(time*4.+.5)-.5)/4.;
  float cycle=abs(fract(time+.5)-.5);
  float horizontal=max(stroke(quarter,.002)*.28,stroke(cycle,.005)*.82)*min(1.,.018/max(fwidth(time),.001));
  float vertical=stroke(abs(fract(x/2.+.5)-.5)*2.,.016)*.38*min(1.,.1/max(fwidth(x),.001));
  float edge=stroke(abs(x)-3.8,.026);
  float gate=stroke(distance-1.,.055)*step(abs(x),3.8);
  float horizon=1.-smoothstep(${String(ROAD_LENGTH * 0.5)}.,${String(ROAD_LENGTH)}.,distance);
  vec3 base=ground;
  vec3 colour=mix(base,lineInk,max(horizontal,vertical)*horizon*mix(.56,1.,step(abs(x),3.8)));
  colour=mix(colour,edgeInk,edge*horizon);
  colour=mix(colour,textInk,gate*.9);
  gl_FragColor=vec4(colour,1.);
  #include <colorspace_fragment>
}`;
const sunFragment = `
varying vec2 vUv;
uniform vec3 ink, ground, highlight, panel;
uniform float progress;
void main(){
  vec2 p=vUv*2.-1.;
  if(length(p)>1.)discard;
  float stripes=step(.0,p.y)+step(.18+(-p.y)*.3,fract(vUv.y*11.+progress));
  if(stripes<.5)discard;
  vec3 colour=mix(ink,highlight,smoothstep(.0,1.,vUv.y)*.45);

  float rim=1.-smoothstep(.975,.994,length(p));
  gl_FragColor=vec4(mix(highlight,colour,rim),1.);
  #include <colorspace_fragment>
}`;

const view: ViewDefinition = {
  id: 'night-drive',
  group: 'show',
  name: 'Night drive',
  tag: 'retro',
  async mount(element) {
    const stage = await createThreeStage(element, 'nightDrive');
    const { THREE, scene, camera, root } = stage;
    camera.fov = 58;
    camera.far = 500;
    camera.updateProjectionMatrix();
    camera.position.set(0, 2.5, 7);
    camera.lookAt(0, 2.1, -100);
    const uniforms = {
      now: { value: 0 },
      windowSize: { value: 4 },
      cps: { value: 1 },
      ground: { value: new THREE.Color() },
      lineInk: { value: new THREE.Color() },
      edgeInk: { value: new THREE.Color() },
      textInk: { value: new THREE.Color() },
      panel: { value: new THREE.Color() },
      lightPass: { value: 0 },
    };
    const skyGeometry = new THREE.PlaneGeometry(2, 2);
    const skyMaterial = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,1.,1.);}',
      fragmentShader: `
        varying vec2 vUv;
        uniform vec3 ground, lineInk, edgeInk;
        uniform float lightPass;
        void main(){
          if(lightPass>.5)discard;
          float haze=exp(-pow((vUv.y-.49)*6.,2.));
          vec3 colour=mix(ground,lineInk,haze*.12);
          colour=mix(colour,edgeInk,haze*.07);
          gl_FragColor=vec4(colour,1.);
          #include <colorspace_fragment>
        }`,
      uniforms,
      depthWrite: false,
      depthTest: false,
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);
    const roadMaterial = new THREE.ShaderMaterial({
      vertexShader: planeVertex,
      fragmentShader: roadFragment,
      uniforms,
      side: THREE.DoubleSide,
    });
    const roadGeometry = new THREE.PlaneGeometry(220, 160);
    roadGeometry.rotateX(-Math.PI / 2);
    const road = new THREE.Mesh(roadGeometry, roadMaterial);
    road.position.z = -72;
    road.position.y = -0.035;
    scene.add(road);
    const sunInk = new THREE.Color(),
      sunHighlight = new THREE.Color();
    const sunMaterial = new THREE.ShaderMaterial({
      vertexShader: planeVertex,
      fragmentShader: sunFragment,
      transparent: true,
      uniforms: {
        ink: { value: sunInk },
        ground: uniforms.ground,
        highlight: { value: sunHighlight },
        progress: { value: 0 },
      },
    });
    const sunGeometry = new THREE.PlaneGeometry(55, 55);
    const sun = new THREE.Mesh(sunGeometry, sunMaterial);
    sun.position.set(0, 36, -160);
    scene.add(sun);
    // A calm, low-poly horizon remains when no setting varies across notes.
    const ridgePositions: number[] = [],
      ridgeEdges: number[] = [];
    for (const side of [-1, 1]) {
      const peaks = [1.5, 8, 3, 11, 6, 13, 4, 9, 2, 7, 3];
      for (let i = 0; i < peaks.length - 1; i++) {
        const x = side * (8 + i * 16),
          next = side * (24 + i * 16);
        ridgePositions.push(
          x,
          0,
          -151,
          next,
          0,
          -151,
          next,
          peaks[i + 1],
          -151,
          x,
          0,
          -151,
          next,
          peaks[i + 1],
          -151,
          x,
          peaks[i],
          -151,
        );
        ridgeEdges.push(x, peaks[i], -150.9, next, peaks[i + 1], -150.9);
      }
    }
    const ridgeGeometry = new THREE.BufferGeometry();
    ridgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ridgePositions, 3));
    const ridgeMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const ridge = new THREE.Mesh(ridgeGeometry, ridgeMaterial);
    const ridgeLineGeometry = new THREE.BufferGeometry();
    ridgeLineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ridgeEdges, 3));
    const ridgeLineMaterial = new THREE.LineBasicMaterial();
    const ridgeLine = new THREE.LineSegments(ridgeLineGeometry, ridgeLineMaterial);
    scene.add(ridge, ridgeLine);

    function label(css: string) {
      const node = document.createElement('div');
      node.style.cssText = `position:absolute;pointer-events:none;${css}`;
      root.append(node);
      return node;
    }
    const title = label('left:24px;top:20px;line-height:1.25');
    const speed = label('right:24px;top:20px;text-align:right;line-height:1.2');
    const sectionLabel = label(
      'left:50%;top:47%;transform:translateX(-50%);text-align:center;letter-spacing:.2em;text-transform:uppercase',
    );
    const caption = label('left:24px;bottom:18px;max-width:40%;line-height:1.8');
    const hillCaption = label(
      'right:24px;bottom:18px;max-width:40%;text-align:right;line-height:1.8',
    );
    const upcoming = label(
      'left:50%;transform:translateX(-50%);padding:5px 10px;text-transform:uppercase;letter-spacing:.14em;white-space:nowrap',
    );
    const car = label('left:50%;bottom:28px;width:156px;height:70px;transform:translateX(-50%)');
    car.innerHTML =
      '<svg viewBox="0 0 180 80" width="100%" height="100%"><path d="M15 76 28 32 50 32 60 8 120 8 130 32 152 32 165 76Z" fill="var(--car-ground)" stroke="var(--car-ink)" stroke-width="2"/><path d="M50 32 60 8 120 8 130 32Z" fill="var(--car-panel)" stroke="var(--car-detail)" stroke-width="2"/><path d="M54 27H126 M57 20H123 M30 61H150 M26 69H154 M35 40H145" fill="none" stroke="var(--car-ink)"/><path d="M37 46H70 M110 46H143" stroke="var(--car-ink)" stroke-width="7"/><path d="M79 49H101" stroke="var(--car-detail)" stroke-width="3"/></svg>';
    const sectionGeometry = new THREE.PlaneGeometry(7.6, 0.65);
    sectionGeometry.rotateX(-Math.PI / 2);
    const sectionMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const sectionBand = new THREE.Mesh(sectionGeometry, sectionMaterial);
    sectionBand.position.y = 0.012;
    scene.add(sectionBand);
    interface Layer {
      mesh: InstanceType<typeof THREE.Mesh>;
      material: InstanceType<typeof THREE.ShaderMaterial>;
    }
    const layers: Layer[] = [];
    let hillMesh: InstanceType<typeof THREE.Mesh> | undefined;
    let hillLine: InstanceType<typeof THREE.LineSegments> | undefined;
    const hillInk = new THREE.Color();
    const hillMaterial = new THREE.ShaderMaterial({
      vertexShader: timedVertex,
      fragmentShader: `
        uniform vec3 ink;
        uniform float lightPass, now, windowSize;
        varying float vTime;
        void main(){
          if(lightPass>.5 || vTime<now-.3 || vTime>now+windowSize) discard;
          gl_FragColor=vec4(ink,1.);
          #include <colorspace_fragment>
        }`,
      uniforms: {
        now: uniforms.now,
        windowSize: uniforms.windowSize,
        ink: { value: hillInk },
        lightPass: uniforms.lightPass,
      },
      side: THREE.DoubleSide,
    });
    const hillLineMaterial = hillMaterial.clone();
    const hillLineInk = new THREE.Color();
    hillLineMaterial.uniforms.ink.value = hillLineInk;
    let notes: ViewFrame['notes'] | undefined,
      inventory = '',
      theme: ViewFrame['theme'] | undefined;
    let driver: ReturnType<typeof hillDriver>;
    let voices: RoadVoice[] = [];
    let last: ViewFrame | undefined;
    let lastSections = '';

    const projected = new THREE.Vector3();
    function releaseLayers() {
      for (const layer of layers) {
        scene.remove(layer.mesh);
        layer.mesh.geometry.dispose();
        layer.material.dispose();
      }
      layers.length = 0;
      for (const mesh of [hillMesh, hillLine])
        if (mesh) {
          scene.remove(mesh);
          mesh.geometry.dispose();
        }
      hillMesh = hillLine = undefined;
    }
    function build(frame: ViewFrame) {
      releaseLayers();
      voices = roadVoices(frame);
      driver = hillDriver(voices);
      for (const voice of voices) {
        const positions: number[] = [],
          timings: number[] = [],
          shades: number[] = [],
          pitches: number[] = [];
        function quad(
          x1: number,
          y1: number,
          t1: number,
          x2: number,
          y2: number,
          t2: number,
          mark: ReturnType<typeof roadMarks>[number],
          shade = 1,
        ) {
          positions.push(x1, y1, t1, x2, y1, t1, x2, y2, t2, x1, y1, t1, x2, y2, t2, x1, y2, t2);
          for (let i = 0; i < 6; i++) {
            timings.push(mark.start, mark.end, mark.onset ? 1 : 0);
            shades.push(shade);
            pitches.push(mark.pitch === undefined ? 0 : 1);
          }
        }
        for (const mark of roadMarks(voice, frame.from, frame.to)) {
          if (voice.dense) {
            const side = voice.slot % 2 ? 1 : -1;
            const x = side * (4.15 + Math.floor(voice.slot / 2) * 0.25);
            quad(x, 0.06, mark.start, x + side * 0.18, 0.06, mark.end, mark);
          } else if (mark.pitch !== undefined) {
            const side = voice.slot % 2 ? 1 : -1;
            const x = side * (4.8 + Math.floor(voice.slot / 2) * 0.55);
            const y = 0.7 + Math.max(0, Math.min(1, (mark.pitch - 24) / 60)) * 4;
            quad(x, y, mark.start, x + side * 1.25, y + 0.14, mark.start, mark);
            // The light bar's length is the note's true duration, including fragments.
            quad(x, y, mark.start, x + side * 0.16, y, mark.end, mark, 0.8);
          } else if (voice.role === 'gates') {
            quad(-3.85, 0, mark.start, -3.73, 3.65, mark.start, mark);
            quad(3.73, 0, mark.start, 3.85, 3.65, mark.start, mark);
            quad(-3.85, 3.65, mark.start, 3.85, 3.78, mark.start, mark);
            quad(-3.85, 3.35, mark.start, -3.25, 3.42, mark.start, mark, 0.55);
            quad(3.25, 3.35, mark.start, 3.85, 3.42, mark.start, mark, 0.55);
          } else if (voice.role === 'lane') {
            quad(-0.065, 0.025, mark.start, 0.065, 0.025, mark.start + 0.018, mark);
          } else {
            for (const side of [-1, 1]) {
              const x = side * (4.65 + voice.slot * 0.16);
              quad(x - 0.035, 0, mark.start, x + 0.035, 1.2, mark.start, mark, 0.65);
              quad(x - 0.47, 1.2, mark.start, x + 0.47, 1.75, mark.start, mark, 0.55);
              quad(x - 0.47, 1.7, mark.start, x + 0.47, 1.77, mark.start, mark);
              quad(x - 0.47, 1.2, mark.start, x + 0.47, 1.27, mark.start, mark);
              quad(x - 0.47, 1.2, mark.start, x - 0.4, 1.77, mark.start, mark);
              quad(x + 0.4, 1.2, mark.start, x + 0.47, 1.77, mark.start, mark);
              quad(x - 0.27, 1.43, mark.start, x + 0.23, 1.49, mark.start, mark);
            }
          }
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('timing', new THREE.Float32BufferAttribute(timings, 3));
        geometry.setAttribute('shade', new THREE.Float32BufferAttribute(shades, 1));
        geometry.setAttribute('pitchedMark', new THREE.Float32BufferAttribute(pitches, 1));
        const material = new THREE.ShaderMaterial({
          vertexShader: timedVertex,
          fragmentShader: timedFragment,
          transparent: true,
          side: THREE.DoubleSide,
          uniforms: {
            now: uniforms.now,
            windowSize: uniforms.windowSize,
            cps: uniforms.cps,
            ground: uniforms.ground,
            panel: uniforms.panel,
            ink: { value: new THREE.Color(voice.instrument.colour) },
            highlight: uniforms.textInk,
            lightPass: uniforms.lightPass,
            muted: { value: voice.instrument.muted ? 0.2 : 1 },
            dense: { value: voice.dense ? 1 : 0 },
            trails: { value: frame.trails },
            baseInk: { value: frame.theme.glow ? 0.68 : 1 },
          },
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.frustumCulled = false;
        scene.add(mesh);
        layers.push({ mesh, material });
      }
      const profile = driver ? hillProfile(driver, frame.from, frame.to) : [];
      const positions: number[] = [],
        edges: number[] = [];
      for (const side of [-1, 1])
        for (let i = 0; i < profile.length - 1; i++) {
          const a = profile[i],
            b = profile[i + 1],
            x = side * 10;
          positions.push(
            x,
            0,
            a.time,
            x,
            a.height,
            a.time,
            x,
            b.height,
            b.time,
            x,
            0,
            a.time,
            x,
            b.height,
            b.time,
            x,
            0,
            b.time,
          );
          edges.push(x, a.height, a.time, x, b.height, b.time);
        }
      function terrain(data: number[]) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
        // Unused attributes are constant; the shared time mapping remains identical.
        g.setAttribute(
          'timing',
          new THREE.Float32BufferAttribute(new Float32Array(data.length), 3),
        );
        g.setAttribute(
          'shade',
          new THREE.Float32BufferAttribute(new Float32Array(data.length / 3), 1),
        );
        return g;
      }
      hillMesh = new THREE.Mesh(terrain(positions), hillMaterial);
      hillMesh.frustumCulled = false;
      hillLine = new THREE.LineSegments(terrain(edges), hillLineMaterial);
      hillLine.frustumCulled = false;
      scene.add(hillMesh, hillLine);
    }
    return {
      frame(frame) {
        if (frame.width <= 0 || frame.height <= 0) return;
        const key =
          frame.instruments
            .map(
              (i) =>
                `${i.id}:${String(i.index)}:${i.name}:${i.colour}:${String(i.inSection)}:${String(i.muted)}`,
            )
            .join('|') + `:${String(frame.from)}:${String(frame.to)}`;
        const sectionKey = frame.sections
          .map((s) => `${s.name}:${String(s.from)}:${String(s.to)}`)
          .join('|');
        if (
          last?.now === frame.now &&
          last.notes === frame.notes &&
          last.theme === frame.theme &&
          last.width === frame.width &&
          last.height === frame.height &&
          last.dpr === frame.dpr &&
          last.lookAhead === frame.lookAhead &&
          last.cps === frame.cps &&
          last.playing === frame.playing &&
          last.trails === frame.trails &&
          lastSections === sectionKey &&
          inventory === key
        )
          return;
        last = { ...frame };
        lastSections = sectionKey;
        stage.resize(frame);
        const changed = notes !== frame.notes || inventory !== key;
        if (changed) {
          build(frame);
          notes = frame.notes;
          inventory = key;
        }
        uniforms.now.value = frame.now;
        uniforms.windowSize.value = Math.max(0.001, frame.lookAhead);
        uniforms.cps.value = frame.cps;
        for (const layer of layers) {
          layer.material.uniforms.trails.value = frame.trails;
          layer.material.uniforms.baseInk.value = frame.theme.glow ? 0.68 : 1;
        }
        hillLineMaterial.uniforms.now.value = frame.now;
        hillLineMaterial.uniforms.windowSize.value = Math.max(0.001, frame.lookAhead);
        const t = frame.theme;
        if (theme !== t || changed) {
          uniforms.ground.value.set(t.ground);
          uniforms.lineInk.value.set(
            voices.find((v) => v.role === 'lane')?.instrument.colour ??
              voices.at(0)?.instrument.colour ??
              t.accent,
          );
          uniforms.panel.value.set(t.panel);
          uniforms.edgeInk.value.set(t.accent);
          uniforms.textInk.value.set(t.text);
          sunInk.set(t.accent);
          sunHighlight.set(voices.find((v) => v.role === 'lane')?.instrument.colour ?? t.text);
          ridgeMaterial.color.set(t.ground);
          ridgeLineMaterial.color.set(t.line);
          hillInk.set(t.panel);
          hillLineInk.set(t.muted);
          sectionMaterial.color.set(t.accent);
          for (const node of [title, speed, sectionLabel, caption, hillCaption, upcoming]) {
            node.style.color = t.text;
            node.style.fontFamily = `"${t.fontMono}",monospace`;
          }
          title.style.fontFamily = `"${t.fontDisplay}",sans-serif`;
          title.style.fontSize = '22px';
          title.style.fontWeight = '800';
          speed.style.fontSize = '14px';
          sectionLabel.style.fontSize = '12px';
          caption.style.fontSize = '11px';
          caption.style.color = t.muted;
          hillCaption.style.color = t.muted;
          hillCaption.style.fontSize = '11px';
          upcoming.style.fontSize = '11px';
          upcoming.style.background = t.panel;
          upcoming.style.border = `1px solid ${t.accent}`;
          car.style.setProperty('--car-ground', t.ground);
          car.style.setProperty('--car-panel', t.panel);
          car.style.setProperty(
            '--car-ink',
            voices.find((v) => v.role === 'gates')?.instrument.colour ?? t.accent,
          );
          car.style.setProperty('--car-detail', t.text);
          theme = t;
        }
        title.textContent = 'Night drive';
        const sections = sectionRoad(frame);
        speed.textContent = `${String(Math.round(frame.cps * 240))} bpm · cycle ${String(Math.floor(frame.now) + 1)}`;
        sectionLabel.textContent = `${sections.current?.name ?? 'open road'} · ${String(Math.floor(sections.progress * 100))}%`;
        sunMaterial.uniforms.progress.value = sections.progress;
        caption.textContent = (['gates', 'posts', 'lane'] as const)
          .flatMap((role) => {
            const names = voices
              .filter((v) => v.notes.length && v.role === role)
              .map((v) => `${v.instrument.name}${v.dense ? ' (occupancy)' : ''}`);
            return names.length ? [`${role}: ${names.join(', ')}`] : [];
          })
          .join(' · ');
        hillCaption.textContent = `hills: ${driver ? `${driver.name} ${driver.setting}` : 'calm'} · the tempo is your speed`;
        car.style.transform = `translateX(calc(-50% + ${String(Math.sin(frame.now * 0.7) * 4)}px))`;
        car.style.width = `${String(Math.min(156, frame.width * 0.2))}px`;
        const next = sections.ahead.at(0);
        sectionBand.visible = !!next;
        upcoming.style.display = next ? 'block' : 'none';
        if (next) {
          sectionBand.position.z = roadZ(next.time, frame.now, frame.lookAhead);
          projected.set(0, 0.05, sectionBand.position.z).project(camera);
          upcoming.style.top = `${String(((1 - projected.y) * frame.height) / 2 + 8)}px`;
          upcoming.textContent = `${next.name} ↗`;
        }
        stage.render(frame, (enabled) => {
          uniforms.lightPass.value = enabled ? 1 : 0;
          hillLineMaterial.uniforms.lightPass.value = enabled ? 1 : 0;
          sun.visible = ridge.visible = ridgeLine.visible = !enabled;
          sectionBand.visible = !enabled && !!next;
        });
      },
      dispose() {
        releaseLayers();
        hillMaterial.dispose();
        hillLineMaterial.dispose();
        skyGeometry.dispose();
        skyMaterial.dispose();
        roadGeometry.dispose();
        roadMaterial.dispose();
        sunGeometry.dispose();
        sunMaterial.dispose();
        ridgeGeometry.dispose();
        ridgeMaterial.dispose();
        ridgeLineGeometry.dispose();
        ridgeLineMaterial.dispose();
        sectionGeometry.dispose();
        sectionMaterial.dispose();
        stage.dispose();
      },
    };
  },
};
export default view;
