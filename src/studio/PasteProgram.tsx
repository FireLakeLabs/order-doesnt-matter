import { useState } from 'react';
import { ClipboardPaste } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import { runtime } from './runtime';
import { examples } from '../app/examples';

/** Work stays mounted while a separate, disposable practice draft is shown. */
export function PasteProgram({
  active,
  disabled,
  error,
}: {
  active: boolean;
  disabled: boolean;
  error: string;
}) {
  const [source, setSource] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const load = async (program = source) => {
    setImporting(true);
    try {
      const before = runtime.app.activation;
      await runtime.load(program);
      if (before !== runtime.app.activation) setPasteOpen(false);
    } finally {
      setImporting(false);
    }
  };
  if (!active) return null;
  return (
    <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" disabled={disabled}>
          <ClipboardPaste />
          Paste
        </Button>
      </DialogTrigger>
      <DialogContent className="paste-dialog">
        <DialogHeader>
          <DialogTitle>Paste Strudel</DialogTitle>
          <DialogDescription>Import a program as a Studio score.</DialogDescription>
        </DialogHeader>
        <div className="dialog-actions">
          <span>Try an original:</span>
          {examples.map((example) => (
            <Button
              key={example.name}
              variant="outline"
              disabled={importing}
              onClick={() => {
                setSource(example.source);
                void load(example.source);
              }}
            >
              {example.name}
            </Button>
          ))}
        </div>
        <textarea
          aria-label="Strudel program"
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
          }}
          spellCheck={false}
        />
        <Button
          disabled={importing || !source.trim()}
          onClick={() => {
            void load();
          }}
        >
          {importing ? 'Importing…' : 'Import program'}
        </Button>
        <p role="status">{error}</p>
      </DialogContent>
    </Dialog>
  );
}
