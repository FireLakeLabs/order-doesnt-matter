import { useRef, useState, useSyncExternalStore } from 'react';
import { Bookmark, Copy, Download, FileUp } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import { runtime, store } from './runtime';
import { useStudioStore } from './store';
import { replacement } from './replacement';
import { session } from './session';

function download(text: string | null, name: string, type: string) {
  if (text === null) return;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}
export function KeepWork() {
  const { state } = useStudioStore(store);
  const { app } = runtime;
  const { editorTarget } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const replacing = useSyncExternalStore(replacement.subscribe, replacement.getSnapshot);
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <Bookmark />
            Keep work
            {app.retention.candidate
              ? ' •'
              : app.retention.notice.includes('could not')
                ? ' !'
                : ''}
          </Button>
        </DialogTrigger>
        <DialogContent className="keep-dialog">
          <DialogHeader>
            <DialogTitle>Keep this version</DialogTitle>
            <DialogDescription>
              Recovery keeps one latest document in this browser on this device. It can be cleared
              by your browser; download a portable copy too.
            </DialogDescription>
          </DialogHeader>
          <p role="status">{app.retention.notice}</p>
          {app.retention.candidate && (
            <Button
              disabled={!!editorTarget}
              onClick={() => {
                void runtime.recover();
              }}
            >
              Recover last work
            </Button>
          )}
          <div className="dialog-actions">
            <Button
              variant="outline"
              disabled={!state.doc}
              onClick={() => {
                download(
                  app.downloadDocument(),
                  app.practice ? 'odm-practice-kiln.json' : 'odm-document.json',
                  'application/json',
                );
              }}
            >
              <Download />
              {app.practice ? 'Download practice document' : 'Download document'}
            </Button>
            <Button
              variant="outline"
              disabled={!state.doc}
              onClick={() => {
                download(
                  app.exportStrudel(),
                  app.practice ? 'odm-practice-kiln.strudel' : 'odm-score.strudel',
                  'text/plain',
                );
              }}
            >
              <Download />
              {app.practice ? 'Export practice Strudel' : 'Export Strudel'}
            </Button>
            <Button
              variant="outline"
              disabled={!state.doc}
              onClick={() => {
                const text = app.exportStrudel();
                if (text)
                  void navigator.clipboard.writeText(text).then(
                    () => {
                      setNotice('Strudel copied.');
                    },
                    () => {
                      setNotice('Could not copy. Export Strudel to keep the code.');
                    },
                  );
              }}
            >
              <Copy />
              Copy Strudel code
            </Button>
            <Button
              variant="outline"
              disabled={!!editorTarget}
              onClick={() => {
                file.current?.click();
              }}
            >
              <FileUp />
              Open document
            </Button>
          </div>
          <input
            ref={file}
            aria-label="Document file"
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              const selected = event.target.files?.[0];
              event.target.value = '';
              const activation = app.activation;
              if (!selected) return;
              void (async () => {
                try {
                  const text = await selected.text();
                  if (activation === app.activation) await runtime.openDocument(text);
                } catch {
                  if (activation === app.activation)
                    setNotice('Could not read this file. Your current work is still here.');
                }
              })();
            }}
          />
          <p role="status">{state.loadError || notice}</p>
        </DialogContent>
      </Dialog>
      <Dialog
        open={replacing}
        onOpenChange={(value) => {
          if (!value) replacement.answer(false);
        }}
      >
        <DialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            document.getElementById('keep-current')?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Replace current work?</DialogTitle>
            <DialogDescription>
              This replaces your current score and Undo history, and the latest recovery on this
              device. Download your document first if you want to keep both.
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-actions">
            <Button
              id="keep-current"
              onClick={() => {
                replacement.answer(false);
              }}
            >
              Keep current
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                replacement.answer(true);
              }}
            >
              Replace
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
