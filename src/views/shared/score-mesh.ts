import type { ViewFrame } from '../types';
import type { ThreeStage } from './three-stage';
import type { Arc } from './ring-model';

export interface ScoreStrip {
  cycle: number;
  radius: number;
  width: number;
  colour: string;
  muted: boolean;
  arcs: (Arc & { coverage?: number })[];
  track?: boolean;
  segments?: number;
}

/** One draw call for a collection of bands, including a whole song's helix. */
export function createScoreMesh(stage: ThreeStage, helix = false) {
  const { THREE } = stage;
  const ground = new THREE.Color(),
    highlight = new THREE.Color();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      now: { value: 0 },
      ground: { value: ground },
      highlight: { value: highlight },
      flashDuration: { value: 0.075 },
      trail: { value: 0.25 },
      lightPass: { value: 0 },
      fade: { value: 1 },
      opacity: { value: 1 },
      hideNear: { value: 0 },
      helix: { value: helix ? 1 : 0 },
      songFrom: { value: 0 },
      songLength: { value: 16 },
    },
    vertexShader: `
      attribute vec3 timing; attribute vec3 band; attribute vec3 ink; attribute float quiet;
      uniform float now; uniform float helix; uniform float songFrom; uniform float songLength;
      varying vec3 vTiming; varying vec3 vInk; varying vec3 vSurface;
      void main(){
        float time=position.x;
        float angle=(time-(helix>0.5?0.:now))*6.28318530718;
        float playing=exp(-pow(abs(time-now)/0.7,4.));
        float r=(band.x+position.y*band.y)*(1.+helix*playing*0.16);
        vec3 point=vec3(sin(angle)*r,cos(angle)*r,position.z);
        if(helix>0.5) point=vec3(((time-songFrom)/songLength-0.5)*10.,cos(angle)*r,sin(angle)*r+position.z);
        vTiming=timing; vInk=ink;
        vSurface=vec3(time,band.z*quiet,helix>0.5?mix(0.34,1.,(sin(angle)+1.)*0.5):1.);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(point,1.);
      }`,
    fragmentShader: `
      uniform float now; uniform float flashDuration; uniform float trail; uniform float lightPass;
      uniform float fade; uniform float opacity; uniform float hideNear; uniform float helix; uniform vec3 ground; uniform vec3 highlight;
      varying vec3 vTiming; varying vec3 vInk; varying vec3 vSurface;
      void main(){
        bool track=vTiming.z<0.;
        if (!track && hideNear>0.5 && abs(floor(vSurface.x)-floor(now))<3.5) discard;
        float sounding=track?0.:step(vTiming.x,now)*(1.-step(vTiming.y,now));
        float flash=max(0.,vTiming.z)*step(vTiming.x,now)*max(0.,1.-(now-vTiming.x)/flashDuration);
        flash*=flash*(1.-smoothstep(0.025,0.055,vSurface.x-vTiming.x));
        float age=now-vSurface.x;
        float brightness=age<=0.?1.:(trail>0.?mix(0.3,1.,max(0.,1.-age/trail)):0.3);
        if(helix>0.5) brightness=max(brightness,0.8);
        brightness=track?0.19:max(brightness,sounding);
        float strength=fade*vSurface.y*vSurface.z;
        if(lightPass>0.5){
          if(sounding+flash<0.001) discard;
          gl_FragColor=vec4(vInk*max(sounding,flash)*strength,opacity);
        }else{
          vec3 colour=mix(ground,vInk,brightness*strength);
          colour=mix(colour,highlight,flash*0.85*strength);
          gl_FragColor=vec4(colour,opacity);
        }
        #include <colorspace_fragment>
      }`,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.frustumCulled = false;
  const colour = new THREE.Color();
  return {
    mesh,
    material,
    populate(strips: ScoreStrip[]) {
      const positions: number[] = [],
        timing: number[] = [],
        bands: number[] = [],
        inks: number[] = [],
        quiet: number[] = [];
      for (const strip of strips) {
        colour.set(strip.colour);
        for (const arc of strip.arcs) {
          const steps = Math.max(1, Math.ceil((arc.to - arc.from) * (strip.segments ?? 128)));
          const vertex = (time: number, radial: number) => {
            positions.push(strip.cycle + time, radial, strip.track ? -0.003 : 0.003);
            timing.push(
              strip.cycle + arc.start,
              strip.cycle + arc.end,
              strip.track ? -1 : arc.onset ? 1 : 0,
            );
            bands.push(strip.radius, strip.width, arc.coverage ?? 1);
            inks.push(colour.r, colour.g, colour.b);
            quiet.push(strip.muted ? 0.23 : 1);
          };
          for (let i = 0; i < steps; i++) {
            const a = arc.from + ((arc.to - arc.from) * i) / steps,
              b = arc.from + ((arc.to - arc.from) * (i + 1)) / steps;
            vertex(a, -0.5);
            vertex(b, -0.5);
            vertex(b, 0.5);
            vertex(a, -0.5);
            vertex(b, 0.5);
            vertex(a, 0.5);
          }
        }
      }
      const geometry = new THREE.BufferGeometry();
      for (const [name, values, size] of [
        ['position', positions, 3],
        ['timing', timing, 3],
        ['band', bands, 3],
        ['ink', inks, 3],
        ['quiet', quiet, 1],
      ] as const)
        geometry.setAttribute(name, new THREE.Float32BufferAttribute(values, size));
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    },
    update(frame: ViewFrame, fade = 1, opacity = 1) {
      const u = material.uniforms;
      u.now.value = frame.now;
      ground.set(frame.theme.ground);
      highlight.set(frame.theme.text);
      u.flashDuration.value = Math.max(0.00001, frame.cps * 0.15);
      u.trail.value = frame.trails === 1 ? 0.25 : frame.trails === 2 ? 1 : 0;
      u.fade.value = fade;
      u.opacity.value = opacity;
    },
    emission(enabled: boolean) {
      material.uniforms.lightPass.value = enabled ? 1 : 0;
    },
    dispose() {
      mesh.geometry.dispose();
      material.dispose();
      mesh.removeFromParent();
    },
  };
}
export type ScoreMesh = ReturnType<typeof createScoreMesh>;
