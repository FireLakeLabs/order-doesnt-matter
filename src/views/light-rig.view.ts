import type { ViewDefinition, ViewFrame } from './types';
import { createThreeStage } from './shared/three-stage';
import { headX, indexRig, rigLook, rigSlots, slotAt } from './light-rig/model';

const vertex = `attribute vec3 ink; attribute float power;
varying vec2 vUv; varying vec3 vInk; varying float vPower;
void main(){vUv=uv;vInk=ink;vPower=power;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const view: ViewDefinition = {
  id: 'light-rig',
  name: 'Light rig',
  group: 'show',
  tag: 'stage lights',
  needs: 'score',
  span: 'window',
  async mount(element) {
    const stage = await createThreeStage(element, 'lightRig');
    const { THREE, scene, camera } = stage;
    const rig = new THREE.Group();
    scene.add(rig);
    const structure = new THREE.Group();
    rig.add(structure);
    const metal = new THREE.MeshStandardMaterial({
      color: 0x343b48,
      roughness: 0.48,
      metalness: 0.35,
    });
    const silver = new THREE.MeshStandardMaterial({
      color: 0xaebbc9,
      roughness: 0.28,
      metalness: 0.65,
    });
    const key = new THREE.DirectionalLight(0xe5eeff, 3.2);
    key.position.set(-5, 9, 6);
    const fill = new THREE.HemisphereLight(0xd5e5ff, 0x263043, 1.8);
    scene.add(key, fill);
    const floorMaterial = new THREE.MeshBasicMaterial();
    const lineMaterial = new THREE.LineBasicMaterial();
    const box = new THREE.BoxGeometry(1, 1, 1);
    const barrel = new THREE.CylinderGeometry(0.19, 0.23, 0.45, 12);
    const lens = new THREE.SphereGeometry(0.15, 10, 6);
    const lensMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const rim = new THREE.TorusGeometry(0.175, 0.035, 6, 16);
    rim.rotateX(Math.PI / 2);
    const yokes = new THREE.InstancedMesh(box, metal, 24 * 3);
    const rims = new THREE.InstancedMesh(rim, silver, 24);
    const housings = new THREE.InstancedMesh(box, metal, 24);
    const barrels = new THREE.InstancedMesh(barrel, metal, 24);
    const lenses = new THREE.InstancedMesh(lens, lensMaterial, 24);
    structure.add(housings, barrels, yokes, rims);
    rig.add(lenses);
    // Shared geometry and instancing keep draw calls independent of note density.
    const platform = new THREE.Mesh(box, floorMaterial);
    platform.position.set(0, -0.22, 0.4);
    platform.scale.set(16.8, 0.4, 8);
    structure.add(platform);
    const backdropMaterial = new THREE.MeshBasicMaterial();
    const backdrop = new THREE.Mesh(box, backdropMaterial);
    backdrop.position.set(0, 3.3, -3.8);
    backdrop.scale.set(17, 7.2, 0.08);
    structure.add(backdrop);
    const rails: number[] = [];
    const line = (...points: number[]) => rails.push(...points);
    for (const z of [-0.35, 0.05]) {
      for (const y of [6.05, 6.45]) line(-7.8, y, z, 7.8, y, z);
      for (let i = 0; i < 26; i++) {
        const x = -7.8 + i * 0.6;
        line(x, 6.05, z, x + 0.6, 6.45, z, x, 6.45, z, x + 0.6, 6.05, z);
      }
    }
    for (const x of [-7.7, 7.7]) {
      line(x, 0, -0.3, x, 6.45, -0.3, x - 0.3, 0, -0.3, x + 0.3, 0, -0.3);
      line(x, 6.45, -0.35, x, 6.45, 0.05);
    }
    const tube = new THREE.CylinderGeometry(0.026, 0.026, 1, 8);
    const truss = new THREE.InstancedMesh(tube, silver, rails.length / 6);
    const segment = new THREE.Object3D();
    const start = new THREE.Vector3(),
      end = new THREE.Vector3(),
      axis = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < rails.length; i += 6) {
      start.fromArray(rails, i);
      end.fromArray(rails, i + 3).sub(start);
      segment.position.copy(start).addScaledVector(end, 0.5);
      segment.scale.set(1, end.length(), 1);
      segment.quaternion.setFromUnitVectors(axis, end.normalize());
      segment.updateMatrix();
      truss.setMatrixAt(i / 6, segment.matrix);
    }
    structure.add(truss);
    rails.length = 0;
    for (let x = -8; x <= 8; x += 2) line(x, 0.005, -3.6, x, 0.005, 4.4);
    for (let z = -3.6; z < 4.5; z += 2) line(-8, 0.005, z, 8, 0.005, z);
    const railGeometry = new THREE.BufferGeometry();
    railGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rails, 3));
    structure.add(new THREE.LineSegments(railGeometry, lineMaterial));
    const haze = { phase: { value: 0 } };
    const beamMaterial = new THREE.ShaderMaterial({
      uniforms: haze,
      vertexShader: vertex,
      fragmentShader: `uniform float phase;varying vec2 vUv;varying vec3 vInk;varying float vPower;
      void main(){if(vPower<=0.)discard;float side=pow(max(0.,1.-abs(vUv.x*2.-1.)),1.7);
      float ends=smoothstep(0.,.035,vUv.y)*(1.-smoothstep(.92,1.,vUv.y));
      float haze=.88+.12*sin(vUv.y*37.+vUv.x*9.+phase);
      gl_FragColor=vec4(vInk,side*ends*haze*vPower*.32);
      #include <colorspace_fragment>
      }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const spotMaterial = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: `varying vec2 vUv;varying vec3 vInk;varying float vPower;
      void main(){if(vPower<=0.)discard;float r=length(vUv*2.-1.);float falloff=pow(max(0.,1.-r),2.);
      gl_FragColor=vec4(vInk,falloff*vPower*.92);
      #include <colorspace_fragment>
      }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    function surface(material: InstanceType<typeof THREE.ShaderMaterial>) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(24 * 12), 3).setUsage(THREE.DynamicDrawUsage),
      );
      geometry.setAttribute(
        'ink',
        new THREE.BufferAttribute(new Float32Array(24 * 12), 3).setUsage(THREE.DynamicDrawUsage),
      );
      geometry.setAttribute(
        'power',
        new THREE.BufferAttribute(new Float32Array(24 * 4), 1).setUsage(THREE.DynamicDrawUsage),
      );
      geometry.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(
          Array.from({ length: 24 }, () => [0, 0, 1, 0, 0, 1, 1, 1]).flat(),
          2,
        ),
      );
      geometry.setIndex(
        Array.from({ length: 24 }, (_, i) => [
          i * 4,
          i * 4 + 1,
          i * 4 + 2,
          i * 4 + 1,
          i * 4 + 3,
          i * 4 + 2,
        ]).flat(),
      );
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      rig.add(mesh);
      return mesh;
    }
    const beams = surface(beamMaterial),
      spots = surface(spotMaterial);
    spots.renderOrder = 1;
    beams.renderOrder = 2;
    function plate(css: string) {
      const el = document.createElement('div');
      el.style.cssText = `position:absolute;pointer-events:none;box-sizing:border-box;${css}`;
      stage.root.append(el);
      return el;
    }
    const title = plate(
      'left:16px;right:16px;top:12px;padding:6px 8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis',
    );
    const legend = plate('left:16px;right:16px;bottom:12px;padding:8px;display:grid;gap:5px 12px');
    const labels = Array.from({ length: 8 }, () => {
      const el = document.createElement('div');
      el.style.cssText =
        'overflow:hidden;white-space:nowrap;text-overflow:ellipsis;line-height:16px;min-width:0';
      legend.append(el);
      return el;
    });
    const object = new THREE.Object3D();
    const up = new THREE.Vector3(0, 1, 0),
      direction = new THREE.Vector3(),
      side = new THREE.Vector3(),
      cameraRay = new THREE.Vector3(),
      nearSide = new THREE.Vector3(),
      farSide = new THREE.Vector3();
    const source = new THREE.Vector3(),
      target = new THREE.Vector3(),
      colour = new THREE.Color(),
      lensColour = new THREE.Color(),
      accent = new THREE.Color(),
      text = new THREE.Color(),
      panel = new THREE.Color(),
      ground = new THREE.Color(),
      glass = new THREE.Color(0x101b28);
    let notes: ViewFrame['notes'] | undefined,
      inventory = '';
    let score = indexRig({ notes: [], instruments: [] });
    let slots: ReturnType<typeof rigSlots> = [];
    let slotKey = '',
      paintKey = '';
    let disposed = false;
    return {
      frame(frame) {
        if (disposed || frame.width <= 0 || frame.height <= 0) return;
        const next = JSON.stringify(frame.instruments.map((i) => [i.id, i.index, i.settings]));
        if (notes !== frame.notes || inventory !== next) {
          score = indexRig(frame);
          notes = frame.notes;
          inventory = next;
          slotKey = paintKey = '';
        }
        const look = rigLook(frame);
        const nextSlotKey = JSON.stringify([
          look.from,
          look.to,
          frame.instruments.map((i) => [i.id, i.index, i.inSection, i.name, i.colour, i.muted]),
        ]);
        if (slotKey !== nextSlotKey) {
          slots = rigSlots(frame, score);
          slotKey = nextSlotKey;
        }
        const nextPaint = JSON.stringify([
          frame.now,
          frame.cps,
          frame.playing,
          frame.width,
          frame.height,
          frame.dpr,
          frame.theme,
          look,
          nextSlotKey,
        ]);
        if (paintKey === nextPaint) return;
        paintKey = nextPaint;
        stage.resize(frame);
        const states = slots.map((slot) => slotAt(slot, score, frame));
        haze.phase.value = (frame.now * 0.7) % (Math.PI * 2);
        const narrow = frame.width < 700;
        for (const material of [beamMaterial, spotMaterial])
          material.blending = frame.theme.glow ? THREE.AdditiveBlending : THREE.NormalBlending;
        // Keep the floor fixtures clear of the legend, including the narrow stage.
        rig.scale.set(Math.min(1, camera.aspect / 1.8), 0.78, 1);
        rig.position.y = 1.35;
        camera.fov = 38;
        camera.position.set(0, 5.3, 13.5);
        camera.lookAt(0, 3.05, 0);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        accent.set(frame.theme.accent);
        text.set(frame.theme.text);
        panel.set(frame.theme.panel);
        const lightTheme = frame.theme.name === 'riso' || frame.theme.name === 'pocket';
        ground.set(frame.theme.ground);
        backdrop.visible = lightTheme;
        backdropMaterial.color.copy(text).lerp(panel, 0.08);
        floorMaterial.color.copy(lightTheme ? backdropMaterial.color : panel);
        lineMaterial.color.copy(text).lerp(panel, 0.45);
        let fixture = 0;
        const heads: { ids: string[]; x: number; aim: number; depth: number }[] = [];
        function writeSurface(mesh: typeof beams, points: number[], power: number) {
          const g = mesh.geometry;
          const positions = g.getAttribute('position'),
            inks = g.getAttribute('ink'),
            powers = g.getAttribute('power');
          for (let j = 0; j < 4; j++) {
            positions.setXYZ(fixture * 4 + j, points[j * 3], points[j * 3 + 1], points[j * 3 + 2]);
            inks.setXYZ(fixture * 4 + j, colour.r, colour.g, colour.b);
            powers.setX(fixture * 4 + j, power);
          }
        }
        function light(
          x: number,
          y: number,
          z: number,
          tx: number,
          tz: number,
          width: number,
          power: number,
        ) {
          source.set(x, y, z);
          target.set(tx, 0.025, tz);
          direction.subVectors(target, source).normalize();
          cameraRay.subVectors(camera.position, source);
          side.crossVectors(direction, cameraRay).normalize();
          const a = nearSide.copy(side).multiplyScalar(0.075),
            b = farSide.copy(side).multiplyScalar(width);
          writeSurface(
            beams,
            [
              source.x - a.x,
              source.y - a.y,
              source.z - a.z,
              source.x + a.x,
              source.y + a.y,
              source.z + a.z,
              target.x - b.x,
              target.y - b.y,
              target.z - b.z,
              target.x + b.x,
              target.y + b.y,
              target.z + b.z,
            ],
            power,
          );
          writeSurface(
            spots,
            [
              tx - width,
              0.03,
              tz - width,
              tx + width,
              0.03,
              tz - width,
              tx - width,
              0.03,
              tz + width,
              tx + width,
              0.03,
              tz + width,
            ],
            power,
          );
          const mountSide = y < 1 ? -1 : 1;
          object.position.copy(source).addScaledVector(up, 0.35 * mountSide);
          object.quaternion.identity();
          object.scale.set(0.7, 0.15, 0.48);
          object.updateMatrix();
          housings.setMatrixAt(fixture, object.matrix);
          // Two arms and their bridge form a stationary U around the tilting head.
          for (let j = 0; j < 3; j++) {
            object.position.set(
              x + (j === 2 ? 0 : j === 0 ? -0.29 : 0.29),
              y + (j === 2 ? 0.28 : 0.1) * mountSide,
              z,
            );
            object.scale.set(j === 2 ? 0.65 : 0.09, j === 2 ? 0.08 : 0.42, 0.13);
            object.updateMatrix();
            yokes.setMatrixAt(fixture * 3 + j, object.matrix);
          }
          object.position.copy(source);
          object.quaternion.setFromUnitVectors(up, direction);
          object.scale.set(1, 1, 1);
          object.updateMatrix();
          barrels.setMatrixAt(fixture, object.matrix);
          object.position.copy(source).addScaledVector(direction, 0.23);
          object.updateMatrix();
          rims.setMatrixAt(fixture, object.matrix);
          object.position.copy(source).addScaledVector(direction, 0.24);
          object.scale.set(1, 0.5, 1);
          object.updateMatrix();
          lenses.setMatrixAt(fixture, object.matrix);
          lenses.setColorAt(
            fixture,
            power > 0 ? lensColour.copy(colour).multiplyScalar(0.08 + power * 0.8) : glass,
          );
          fixture++;
        }
        slots.forEach((slot, i) => {
          const state = states[i];
          colour.set(state.leader.instrument.colour).lerp(accent, (look.index % 4) * 0.09);
          // Pocket's inks are dark greens: tint them toward its paper on the dark stage.
          if (frame.theme.name === 'pocket') colour.lerp(ground, 0.55);
          const power = state.brightness;
          if (slot.role === 'strobe') light(0, 6.4, -0.15, 0, -1, 2.6, power);
          else if (slot.role === 'wash')
            for (let j = 0; j < 5; j++)
              light(
                -6 + j * 3,
                0.45,
                2.8,
                -6 + j * 3,
                -0.5 - state.aim * 0.18,
                2.4 + state.aim * 0.32,
                power,
              );
          else {
            const x = headX(slot);
            const aim = state.aim;
            const cross = look.index % 2 ? -1 : 1;
            const depth = [-0.7, 1.4, -1.6, 0.5][look.index % 4];
            light(-x, 5.7, -0.1, -aim * cross, depth, 0.65 + aim * 0.12, power);
            light(x, 5.7, -0.1, aim * cross, depth, 0.65 + aim * 0.12, power);
            heads.push({ ids: slot.members.map((i) => i.id), x, aim, depth });
          }
          const names =
            slot.members.length > 1
              ? `${String(slot.members.length)} parts · ${state.leader.instrument.name}`
              : slot.members[0].name;
          const status =
            [
              state.flashing ? `${String(state.flashing)} flash` : '',
              state.held ? `${String(state.held)} held` : '',
            ]
              .filter(Boolean)
              .join(' + ') || 'off';
          const role =
            slot.role === 'heads'
              ? `H${String(slot.bank + 1)} ×2`
              : slot.role === 'wash'
                ? 'FLOOR ×5'
                : state.merged > 1
                  ? `STROBE (${String(state.merged)} merged)`
                  : 'STROBE';
          labels[i].hidden = false;
          labels[i].textContent =
            `${role} · ${status}${slot.role === 'strobe' && state.active ? ` · ${String(state.active)} ${state.active === 1 ? 'note' : 'notes'}` : ''} · ${names}`;
          labels[i].title = slot.members.map((m) => m.name).join(', ');
        });
        labels.forEach((el, i) => {
          if (i >= slots.length) el.hidden = true;
        });
        for (const mesh of [housings, barrels, lenses, yokes, rims]) {
          mesh.count = mesh === yokes ? fixture * 3 : fixture;
          mesh.instanceMatrix.needsUpdate = true;
          mesh.frustumCulled = false;
        }
        if (lenses.instanceColor) lenses.instanceColor.needsUpdate = true;
        for (const mesh of [beams, spots]) {
          mesh.geometry.setDrawRange(0, fixture * 6);
          for (const key of ['position', 'ink', 'power'])
            mesh.geometry.getAttribute(key).needsUpdate = true;
        }
        title.textContent = `Light rig · ${look.name} · look ${String(look.index + 1)} · bar ${String(Math.floor(frame.now) + 1)} · ${String(Math.min(99, Math.round((frame.now - Math.floor(frame.now)) * 100)))}%`;
        for (const el of [title, legend]) {
          el.style.background = frame.theme.ground;
          el.style.color = frame.theme.text;
          el.style.font = `${String(narrow ? 11 : 12)}px "${frame.theme.fontMono}"`;
        }
        legend.style.gridTemplateColumns = `repeat(${slots.length === 1 ? '1' : '2'},minmax(0,1fr))`;
        // Hide structural ink during selective bloom; emission stays local to the fixtures.
        stage.render(frame, (emission) => {
          structure.visible = !emission;
        });
        stage.canvas.dataset.heads = JSON.stringify(heads);
        stage.canvas.dataset.fixtures = String(fixture);
        stage.canvas.dataset.assignments = String(slots.reduce((n, s) => n + s.members.length, 0));
        stage.canvas.dataset.active = String(states.reduce((n, s) => n + s.active, 0));
        stage.canvas.dataset.flashing = String(states.reduce((n, s) => n + s.flashing, 0));
        stage.canvas.dataset.held = String(states.reduce((n, s) => n + s.held, 0));
        stage.canvas.dataset.look = String(look.index);
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        for (const geometry of [
          box,
          barrel,
          lens,
          rim,
          tube,
          railGeometry,
          beams.geometry,
          spots.geometry,
        ])
          geometry.dispose();
        for (const material of [
          metal,
          silver,
          backdropMaterial,
          floorMaterial,
          lineMaterial,
          lensMaterial,
          beamMaterial,
          spotMaterial,
        ])
          material.dispose();
        for (const mesh of [housings, barrels, lenses, yokes, rims, truss]) mesh.dispose();
        stage.dispose();
      },
    };
  },
};
export default view;
