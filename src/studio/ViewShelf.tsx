import { useEffect, useState } from 'react';
import { views } from '../views';
import type { ViewDefinition } from '../views/types';
import { Button } from '../components/ui/button';
export function ViewShelf({ onSelect }: { onSelect: (id: string) => void }) {
  const [definitions, setDefinitions] = useState<ViewDefinition[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all(views.map((view) => view.load()))
      .then((result) => {
        if (active) setDefinitions(result);
      })
      .catch((reason: unknown) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <aside className="view-shelf region" data-region="view-shelf">
      <h2>
        Views <small>{views.length}</small>
      </h2>
      {definitions.map((view) => (
        <Button
          className="view-tile"
          variant="outline"
          key={view.id}
          onClick={() => {
            onSelect(view.id);
          }}
        >
          <strong>{view.name}</strong>
          <small>{view.tag}</small>
        </Button>
      ))}
      {error && <p role="alert">{error}</p>}
    </aside>
  );
}
