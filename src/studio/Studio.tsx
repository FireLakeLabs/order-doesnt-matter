import { useState } from 'react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import { TopBar } from './TopBar';
import { ScrubStrip } from './ScrubStrip';
import { InstrumentRail } from './InstrumentRail';
import { ViewStage } from './ViewStage';
import { ViewShelf } from './ViewShelf';
import { ScoreArea } from './ScoreArea';
import { Tray } from './Tray';
import { store } from './runtime';
import { useStudioStore } from './store';
import { useTheme } from './useTheme';

export function Studio() {
  const snapshot = useStudioStore(store);
  const { theme, setTheme } = useTheme();
  const [viewId, setViewId] = useState('test-card');
  const [mounted, setMounted] = useState(true);
  const [shelfOpen, setShelfOpen] = useState(false);
  const select = (id: string) => {
    setViewId(id);
    setMounted(true);
    setShelfOpen(false);
  };
  return (
    <main className="studio">
      <TopBar snapshot={snapshot} theme={theme.name} setTheme={setTheme} />
      <ScrubStrip />
      <div className="workspace">
        <InstrumentRail state={snapshot.state} theme={theme.name} />
        <section className="stage-a region" data-region="stage-a">
          <header>
            <h2>
              Stage A <small>{viewId}</small>
            </h2>
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMounted(!mounted);
                }}
              >
                {mounted ? 'Unmount view' : 'Mount view'}
              </Button>
              <span className="compact-shelf">
                <Dialog open={shelfOpen} onOpenChange={setShelfOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">
                      Views
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Choose a view</DialogTitle>
                      <DialogDescription>Draw the score in Stage A.</DialogDescription>
                    </DialogHeader>
                    <ViewShelf onSelect={select} />
                  </DialogContent>
                </Dialog>
              </span>
            </div>
          </header>
          {mounted && <ViewStage viewId={viewId} theme={theme} />}
        </section>
        <section className="stage-b region placeholder" data-region="stage-b">
          <h2>Stage B</h2>
          <p>Choose a second view</p>
        </section>
        <div className="wide-shelf">
          <ViewShelf onSelect={select} />
        </div>
      </div>
      <div className="bottom-regions">
        <ScoreArea />
        <Tray />
      </div>
    </main>
  );
}
