import { useEffect, useState } from 'react';
import { views } from '../views';
import type { ViewDefinition } from '../views/types';
import { Button } from '../components/ui/button';
import type { Layout, Stage } from './session';

const groups = ['rhythm', 'pitch', 'settings', 'song', 'show', 'arcade'] as const;
type Group = ViewDefinition['group'];
const storageKey = 'odm-view-groups';
function rememberedGroups(): Set<Group> | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (
      Array.isArray(saved) &&
      saved.every(
        (g: unknown): g is Group => typeof g === 'string' && groups.some((group) => group === g),
      )
    )
      return new Set(saved);
  } catch {
    /* Storage is a convenience; the shelf works without it. */
  }
  return null;
}
export const viewDragType = 'application/x-odm-view';
export function ViewShelf({
  onSelect,
  choices,
}: {
  onSelect: (stage: Stage, id: string) => void;
  choices: Pick<Layout, 'a' | 'b'>;
}) {
  const [definitions, setDefinitions] = useState<
    Pick<ViewDefinition, 'id' | 'name' | 'tag' | 'group'>[]
  >([]);
  const [openGroups, setOpenGroups] = useState(rememberedGroups);
  const initialChoices = useState(choices)[0];
  const expanded =
    openGroups ??
    new Set(
      definitions
        .filter((v) => v.id === initialChoices.a || v.id === initialChoices.b)
        .map((v) => v.group),
    );
  function toggle(group: Group) {
    const next = new Set(expanded);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    setOpenGroups(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch {
      /* Optional persistence. */
    }
    // A mounted wide shelf and a later popover share the viewer's preference.
    window.dispatchEvent(new CustomEvent('odm-view-groups', { detail: [...next] }));
  }
  useEffect(() => {
    const update = (event: Event) => {
      setOpenGroups(new Set((event as CustomEvent<Group[]>).detail));
    };
    window.addEventListener('odm-view-groups', update);
    return () => {
      window.removeEventListener('odm-view-groups', update);
    };
  }, []);
  useEffect(() => {
    let active = true;
    void Promise.all(
      views.map(async (entry) => {
        try {
          return await entry.load();
        } catch {
          return { id: entry.id, name: entry.id, tag: 'Could not load', group: 'show' as const };
        }
      }),
    ).then((result) => {
      if (active) setDefinitions(result);
    });
    return () => {
      active = false;
    };
  }, []);
  return (
    <aside className="view-shelf region" data-region="view-shelf">
      <header>
        <h2>
          Views <small>{views.filter((view) => view.id !== 'test-card').length}</small>
        </h2>
        <p>Click for A · drag to either stage</p>
      </header>
      <div className="view-groups">
        {groups.map((group) => (
          <section className="view-group" data-group={group} key={group}>
            <button
              className="view-group-toggle"
              aria-expanded={expanded.has(group)}
              onClick={() => {
                toggle(group);
              }}
            >
              <span>{group[0].toUpperCase() + group.slice(1)}</span>
              <small>
                {definitions.filter((v) => v.group === group && v.id !== 'test-card').length}
              </small>
              <span aria-hidden="true">{expanded.has(group) ? '−' : '+'}</span>
            </button>
            <div className="view-tiles" hidden={!expanded.has(group)}>
              {definitions
                .filter((view) => view.group === group)
                .map((view) => (
                  <div
                    className="view-tile"
                    data-view={view.id}
                    data-on-stage={choices.a === view.id || choices.b === view.id}
                    key={view.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData(viewDragType, view.id);
                      event.dataTransfer.setData('text/plain', view.id);
                      event.dataTransfer.effectAllowed = 'copy';
                    }}
                  >
                    <button
                      className="view-choice"
                      onClick={() => {
                        onSelect('a', view.id);
                      }}
                      aria-label={`${view.name} on Stage A`}
                    >
                      <i
                        className={`view-pattern pattern-${String(definitions.indexOf(view) % 4)}`}
                        aria-hidden="true"
                      />
                      <span>
                        <strong>{view.name}</strong>
                        <small>{view.tag}</small>
                      </span>
                    </button>
                    <Button
                      className="view-to-b"
                      variant="ghost"
                      size="sm"
                      aria-label={`${view.name} on Stage B`}
                      onClick={() => {
                        onSelect('b', view.id);
                      }}
                    >
                      B
                    </Button>
                    <span className="stage-marks">
                      {choices.a === view.id && 'A'}
                      {choices.b === view.id && ' B'}
                    </span>
                  </div>
                ))}
            </div>
          </section>
        ))}
        <a
          className="view-file"
          href="https://github.com/FireLakeLabs/order-doesnt-matter/blob/main/research/redesign/design.md#a-view-is-one-file"
          target="_blank"
          rel="noopener"
        >
          + A view is one file
        </a>
      </div>
    </aside>
  );
}
