import { useEffect, useState } from 'react';
import { views } from '../views';
import { Button } from '../components/ui/button';
import type { Layout, Stage } from './session';

export const viewDragType = 'application/x-odm-view';
export function ViewShelf({
  onSelect,
  choices,
}: {
  onSelect: (stage: Stage, id: string) => void;
  choices: Pick<Layout, 'a' | 'b'>;
}) {
  const [definitions, setDefinitions] = useState<{ id: string; name: string; tag: string }[]>([]);
  useEffect(() => {
    let active = true;
    void Promise.all(
      views.map(async (entry) => {
        try {
          return await entry.load();
        } catch {
          return { id: entry.id, name: entry.id, tag: 'Could not load' };
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
          Views <small>{views.length}</small>
        </h2>
        <p>Click for A · drag to either stage</p>
      </header>
      <div className="view-tiles">
        {definitions.map((view, index) => (
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
              <i className={`view-pattern pattern-${String(index % 4)}`} aria-hidden="true" />
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
