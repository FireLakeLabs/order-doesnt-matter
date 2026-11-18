import type { ViewDefinition, ViewFrame } from './types';
import { createThreeStage } from './shared/three-stage';
import { createScoreMesh } from './shared/score-mesh';
import { cycleScore } from './shared/cycle-score';
import { cycleStrips, scoreInventory } from './shared/score-strips';
import { coilDetail, coilRange, helixPoint, coilPose, clampPitch } from './coil/model';
import { createBarPanel, noteDescription } from './coil/inspect';
import { pickSurfaces, pickSurface } from './coil/picking';
import type { ViewNote } from './types';
import type { ScoreStrip } from './shared/score-mesh';

const view: ViewDefinition = {
  id: 'coil',
  group: 'song',
  name: 'Coil',
  tag: 'whole song',
  span: 'song',
  async mount(element) {
    const stage = await createThreeStage(element, 'coil');
    const { THREE, scene, camera, root, canvas } = stage;
    camera.fov = 45;
    const body = new THREE.Group();
    scene.add(body);
    const score = createScoreMesh(stage, true);
    const detail = createScoreMesh(stage, true);
    body.add(score.mesh, detail.mesh);
    const gateMaterial = new THREE.MeshBasicMaterial();
    const gateGeometry = new THREE.SphereGeometry(0.026, 12, 8);
    const bead = new THREE.Mesh(gateGeometry, gateMaterial);
    body.add(bead);
    const lineGeometry = new THREE.BufferGeometry();
    const lineMaterial = new THREE.LineBasicMaterial();
    const gate = new THREE.Line(lineGeometry, lineMaterial);
    body.add(gate);
    const labels = document.createElement('div');
    labels.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    root.append(labels);
    const tooltip = document.createElement('div');
    tooltip.className = 'coil-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.style.cssText =
      'display:none;position:absolute;pointer-events:none;white-space:pre-wrap;max-width:340px;padding:10px;border:1px solid;z-index:3;font-size:12px';
    root.append(tooltip);
    const hoverScore = createScoreMesh(stage, true);
    body.add(hoverScore.mesh);
    hoverScore.material.polygonOffset = true;
    hoverScore.material.polygonOffsetFactor = -1;
    hoverScore.material.polygonOffsetUnits = -1;
    let hovered: ViewNote | undefined;
    let flat: number | undefined;
    let dirty = true;
    const showNote = (note: ViewNote | undefined, x: number, y: number) => {
      if (!last) return false;
      const changed = hovered !== note;
      if (changed) {
        hovered = note;
        dirty = true;
      }
      tooltip.style.display = note ? 'block' : 'none';
      if (note) {
        tooltip.textContent = noteDescription(note, last);
        tooltip.style.background = last.theme.panel;
        tooltip.style.color = last.theme.text;
        tooltip.style.borderColor = last.theme.accent;
        tooltip.style.fontFamily = last.theme.fontMono;
        tooltip.style.left = `${String(Math.max(4, Math.min(x + 14, last.width - 360)))}px`;
        tooltip.style.top = `${String(Math.max(4, Math.min(y + 14, last.height - tooltip.offsetHeight - 8)))}px`;
      }
      return changed;
    };
    const panel = createBarPanel(
      root,
      (note, x, y) => {
        if (showNote(note, x, y)) redraw();
      },
      () => {
        flat = undefined;
        showNote(undefined, 0, 0);
        redraw();
      },
    );
    const caption = document.createElement('div');
    caption.style.cssText =
      'position:absolute;left:4%;right:4%;bottom:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
    const help = document.createElement('span');
    const stretchLabel = document.createElement('label');
    stretchLabel.textContent = 'Turn spacing ';
    const stretchInput = document.createElement('input');
    stretchInput.type = 'range';
    stretchInput.min = '1';
    stretchInput.max = '3';
    stretchInput.step = '.01';
    stretchInput.value = '1';
    stretchInput.setAttribute('aria-label', 'Turn spacing');
    stretchInput.style.width = '90px';
    stretchLabel.append(stretchInput);
    caption.append(help, stretchLabel);
    root.append(caption);
    let notes: ViewFrame['notes'] | undefined,
      inventory = '',
      topology = '',
      theme: ViewFrame['theme'] | undefined;
    let rangeKey = '',
      detailCycle = NaN;
    let brackets: { element: HTMLDivElement; from: number; to: number; name: string }[] = [];
    let yaw = 0.65,
      pitch = 0.22,
      zoom = 1,
      stretch = 1,
      slide = 0;
    let phase: number | undefined;
    const pan = new THREE.Vector3();
    let surfaces: ReturnType<typeof pickSurfaces> = [];
    let drag:
      | {
          id: number;
          x: number;
          y: number;
          yaw: number;
          pitch: number;
          slide: number;
          sliding: boolean;
          moved: boolean;
        }
      | undefined;
    const raycaster = new THREE.Raycaster();
    const inverse = new THREE.Matrix4();
    function redraw() {
      dirty = true;
      if (last) draw(last);
    }
    function pick(event: MouseEvent) {
      if (!last) return;
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          1 - ((event.clientY - rect.top) / rect.height) * 2,
        ),
        camera,
      );
      inverse.copy(body.matrixWorld).invert();
      return pickSurface(THREE, raycaster.ray.clone().applyMatrix4(inverse), surfaces, last.now);
    }
    const down = (event: PointerEvent) => {
      if ((event.button !== 0 && event.button !== 2) || drag) return;
      root.focus();
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        yaw,
        pitch,
        slide,
        sliding: event.shiftKey || event.button === 2,
        moved: false,
      };
      showNote(undefined, 0, 0);
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (drag?.id === event.pointerId) {
        const dx = event.clientX - drag.x,
          dy = event.clientY - drag.y;
        drag.moved ||= Math.hypot(dx, dy) > 4;
        if (drag.sliding) slide = drag.slide - ((dx / Math.max(1, last?.width ?? 1)) * 12) / zoom;
        else {
          yaw = drag.yaw - dx * 0.008;
          pitch = clampPitch(drag.pitch + dy * 0.008);
        }
        redraw();
      } else {
        const rect = root.getBoundingClientRect();
        if (showNote(pick(event)?.note, event.clientX - rect.left, event.clientY - rect.top))
          redraw();
      }
    };
    const up = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) return;
      const clicked = event.type === 'pointerup' && !drag.moved && event.button === 0;
      drag = undefined;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (clicked) {
        const hit = pick(event);
        if (hit) flat = flat === hit.cycle ? undefined : hit.cycle;
      }
      redraw();
    };
    const reset = (event: MouseEvent) => {
      if (pick(event)) return;
      yaw = 0.65;
      pitch = 0.22;
      zoom = 1;
      stretch = 1;
      slide = 0;
      pan.set(0, 0, 0);
      phase = undefined;
      flat = undefined;
      stretchInput.value = '1';
      showNote(undefined, 0, 0);
      redraw();
    };
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!last) return;
      const next = Math.max(1, Math.min(8, zoom * Math.exp(-event.deltaY * 0.0015)));
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          1 - ((event.clientY - rect.top) / rect.height) * 2,
        ),
        camera,
      );
      const normal = camera.getWorldDirection(new THREE.Vector3());
      const target = new THREE.Vector3(slide, 0, 0).add(pan);
      const anchor = raycaster.ray.intersectPlane(
        new THREE.Plane().setFromNormalAndCoplanarPoint(normal, target),
        new THREE.Vector3(),
      );
      if (anchor) pan.add(anchor.sub(target).multiplyScalar(1 - zoom / next));
      zoom = next;
      showNote(undefined, 0, 0);
      redraw();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && flat !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        flat = undefined;
        showNote(undefined, 0, 0);
        redraw();
      }
    };
    const leave = () => {
      if (!drag) {
        showNote(undefined, 0, 0);
        redraw();
      }
    };
    const context = (event: Event) => {
      event.preventDefault();
    };
    const spacing = () => {
      stretch = Number(stretchInput.value);
      showNote(undefined, 0, 0);
      redraw();
    };
    root.tabIndex = 0;
    root.style.outline = 'none';
    root.addEventListener('keydown', keydown);
    stretchInput.addEventListener('input', spacing);
    canvas.style.touchAction = 'none';
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('dblclick', reset);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('contextmenu', context);
    let last: ViewFrame | undefined;
    const point = new THREE.Vector3();
    function draw(frame: ViewFrame) {
      if (frame.width <= 0 || frame.height <= 0) return;
      const key = scoreInventory(frame);
      if (
        !dirty &&
        last?.now === frame.now &&
        last.notes === frame.notes &&
        last.theme === frame.theme &&
        key === inventory &&
        last.width === frame.width &&
        last.height === frame.height &&
        last.dpr === frame.dpr &&
        last.trails === frame.trails &&
        last.cps === frame.cps
      )
        return;
      dirty = false;
      last = { ...frame };
      const resized = stage.resize(frame);
      const range = coilRange(frame);
      if (flat !== undefined && (flat < range.from || flat >= range.to)) flat = undefined;
      const sectionsKey = frame.sections
        .map((s) => `${s.name}:${String(s.from)}:${String(s.to)}`)
        .join('|');
      const nextRangeKey = `${String(range.from)}:${String(range.length)}:${sectionsKey}`;
      const cycle = Math.floor(frame.now);
      const shape = frame.instruments.map((i) => `${i.id}:${String(i.index)}`).join('|');
      const changed = notes !== frame.notes || topology !== shape || rangeKey !== nextRangeKey;
      const styled = resized || theme !== frame.theme || inventory !== key;
      const compressed = range.length > 64;
      if (changed || styled) {
        // A continuous outer spine joins the loops even where section membership
        // changes the instrument bands within them.
        const strips: ScoreStrip[] = [
          {
            cycle: range.from,
            radius: 1.025,
            width: 0.004,
            colour: frame.theme.muted,
            muted: false,
            track: true,
            segments: range.length > 64 ? 24 : 128,
            arcs: [{ from: 0, to: range.length, start: 0, end: 0, onset: false }],
          },
        ];
        for (let cycle = range.from; cycle < range.to; cycle++)
          strips.push(...cycleStrips(frame, cycle, compressed));
        if (changed || !score.restyle(strips)) score.populate(strips);
        score.material.uniforms.songFrom.value = range.from;
        score.material.uniforms.songLength.value = range.length;
        score.material.uniforms.hideNear.value = compressed ? 1 : 0;
      }
      detail.mesh.visible = compressed;
      if (compressed && (changed || styled || detailCycle !== cycle)) {
        // Only seven nearby loops change detail at a seam; the whole-song
        // occupancy and connecting spine retain their original GPU buffers.
        const strips: ScoreStrip[] = [];
        for (
          let turn = Math.max(range.from, cycle - 3);
          turn < Math.min(range.to, cycle + 4);
          turn++
        )
          if (coilDetail(turn, frame.now, range.length))
            strips.push(...cycleStrips(frame, turn).filter((strip) => !strip.track));
        if (changed || detailCycle !== cycle || !detail.restyle(strips)) detail.populate(strips);
        detail.material.uniforms.songFrom.value = range.from;
        detail.material.uniforms.songLength.value = range.length;
        detailCycle = cycle;
      }
      if (changed && hovered) showNote(undefined, 0, 0);
      if (changed || styled) hoverScore.mesh.userData.key = undefined;
      if (changed || styled) surfaces = pickSurfaces(frame, range.from, range.to);
      notes = frame.notes;
      inventory = key;
      topology = shape;
      theme = frame.theme;
      if (rangeKey !== nextRangeKey) {
        labels.replaceChildren();
        brackets = [];
        for (const section of frame.sections) {
          const element = document.createElement('div');
          element.style.cssText =
            'position:absolute;height:12px;border:1px solid;border-top:0;white-space:nowrap;padding-top:18px;font-size:12px';
          element.className = 'coil-section';
          const name = document.createElement('span');
          name.style.cssText =
            'display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis';
          name.textContent = section.name;
          name.title = section.name;
          element.append(name);
          labels.append(element);
          brackets.push({
            element,
            from: section.from + range.from,
            to: section.to + range.from,
            name: section.name,
          });
        }
        rangeKey = nextRangeKey;
      }
      phase ??= Math.PI / 2 - frame.now * Math.PI * 2;
      body.rotation.x = phase;
      body.scale.x = stretch;
      const { distance } = coilPose(frame);
      const target = new THREE.Vector3(slide, 0, 0).add(pan);
      camera.position
        .set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
        .multiplyScalar(distance / zoom)
        .add(target);
      camera.lookAt(target);
      camera.near = 0.02;
      camera.far = distance * 8;
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      body.updateMatrixWorld();
      score.update(frame);
      detail.update(frame);
      hoverScore.mesh.visible = !!hovered;
      if (hovered) {
        const selected = hovered;
        const strips: ScoreStrip[] = [];
        for (
          let turn = Math.max(range.from, Math.floor(hovered.start));
          turn < Math.min(range.to, hovered.end);
          turn++
        ) {
          const band = cycleScore(frame, turn).find((b) => b.id === selected.instrument);
          if (band)
            strips.push({
              ...band,
              cycle: turn,
              muted: false,
              colour: frame.theme.text,
              arcs: [
                {
                  from: Math.max(0, hovered.start - turn),
                  to: Math.min(1, hovered.end - turn),
                  start: hovered.start - turn,
                  end: hovered.end - turn,
                  onset: false,
                },
              ],
            });
        }
        const hoverKey = `${String(frame.notes.indexOf(hovered))}:${key}:${String(frame.width)}:${String(frame.height)}`;
        if (hoverScore.mesh.userData.key !== hoverKey) {
          hoverScore.populate(strips);
          hoverScore.mesh.userData.key = hoverKey;
        }
        hoverScore.material.uniforms.songFrom.value = range.from;
        hoverScore.material.uniforms.songLength.value = range.length;
        hoverScore.update(frame);
      }
      panel.draw(frame, flat, range, hovered);
      const at = helixPoint(frame.now, range.from, range.length, 1.18);
      bead.position.set(at.x, at.y, at.z);
      const inner = helixPoint(frame.now, range.from, range.length, 0.25);
      const positions = new Float32Array([inner.x, inner.y, inner.z, at.x, at.y, at.z]);
      if (!Object.hasOwn(lineGeometry.attributes, 'position'))
        lineGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      else {
        const attribute = lineGeometry.getAttribute('position');
        (attribute.array as Float32Array).set(positions);
        attribute.needsUpdate = true;
      }
      gate.frustumCulled = false;
      bead.frustumCulled = false;
      gateMaterial.color.set(frame.theme.text);
      lineMaterial.color.set(frame.theme.text);
      point.set(0, -1.5, 0).project(camera);
      const baseline = Math.min(frame.height - 110, ((1 - point.y) * frame.height) / 2);
      for (const bracket of brackets) {
        point
          .set(((bracket.from - range.from) / range.length - 0.5) * 10 * stretch, -1.5, 0)
          .project(camera);
        const x = ((point.x + 1) * frame.width) / 2;
        point
          .set(((bracket.to - range.from) / range.length - 0.5) * 10 * stretch, -1.5, 0)
          .project(camera);
        const right = ((point.x + 1) * frame.width) / 2;
        const active = frame.now >= bracket.from && frame.now < bracket.to;
        bracket.element.style.left = `${String(x)}px`;
        bracket.element.style.top = `${String(baseline)}px`;
        bracket.element.style.width = `${String(Math.max(1, right - x - 4))}px`;
        bracket.element.style.color = active ? frame.theme.text : frame.theme.muted;
        bracket.element.style.borderColor = active ? frame.theme.accent : frame.theme.line;
        bracket.element.style.fontFamily = `"${frame.theme.fontMono}"`;
      }
      help.textContent = `${range.open ? '16 cycles shown' : `cycle ${String(Math.floor(frame.now - range.from) + 1)} / ${String(range.length)}`} · drag orbit · wheel zoom · shift/right drag slide · double-click reset`;
      caption.style.color = frame.theme.muted;
      caption.style.font = `13px "${frame.theme.fontMono}"`;
      stage.render(frame, (enabled) => {
        gate.visible = bead.visible = !enabled;
        score.emission(enabled);
        detail.emission(enabled);
        hoverScore.emission(enabled);
      });
    }
    return {
      frame: draw,
      dispose() {
        if (drag && canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
        canvas.removeEventListener('pointerdown', down);
        canvas.removeEventListener('pointermove', move);
        canvas.removeEventListener('pointerup', up);
        canvas.removeEventListener('pointercancel', up);
        canvas.removeEventListener('lostpointercapture', up);
        root.removeEventListener('keydown', keydown);
        stretchInput.removeEventListener('input', spacing);
        canvas.removeEventListener('pointerleave', leave);
        canvas.removeEventListener('dblclick', reset);
        canvas.removeEventListener('wheel', wheel);
        canvas.removeEventListener('contextmenu', context);
        panel.dispose();
        hoverScore.dispose();
        score.dispose();
        detail.dispose();
        gateGeometry.dispose();
        gateMaterial.dispose();
        lineGeometry.dispose();
        lineMaterial.dispose();
        stage.dispose();
      },
    };
  },
};
export default view;
