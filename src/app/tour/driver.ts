import { driver, type PopoverDOM } from 'driver.js';

/** 1.10.2's exported API, not newer documentation-only options. Locally bundled.
 * Its Tab trap is unconditional even with allowKeyboardControl:false. The shell
 * stops Tab propagation in capture without preventing native focus navigation. */
export function createGuide(host: HTMLElement, next: () => void, back: () => void) {
  let popover: PopoverDOM | undefined;
  const presenter = driver({
    animate: false,
    allowKeyboardControl: false,
    allowClose: false,
    overlayOpacity: 0,
    smoothScroll: false,
    onPopoverRender(dom) {
      popover = dom;
      dom.title.setAttribute('role', 'heading');
      dom.title.setAttribute('aria-level', '2');
      const layer = dom.wrapper.parentElement;
      host.append(dom.wrapper);
      // Driver creates a native popover layer inside an enlarged preview. Once
      // guidance moves into its reserved area, remove the now-empty top layer.
      if (layer?.classList.contains('driver-layer') && !layer.childElementCount) layer.remove();
      document.getElementById('tour-actions')!.replaceChildren(dom.footer);
      dom.nextButton.onclick = next;
      dom.previousButton.onclick = back;
      dom.wrapper.setAttribute('role', 'region');
      dom.wrapper.removeAttribute('aria-modal');
      dom.wrapper.tabIndex = -1;
      dom.title.parentElement!.setAttribute('aria-live', 'polite');
    },
  });
  return {
    show(
      target: HTMLElement,
      index: number,
      title: string,
      description: string,
      complete: boolean,
    ) {
      const focus = document.activeElement as HTMLElement | null;
      target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      presenter.highlight({
        element: target,
        popover: {
          title: `${index + 1} of 8 · ${title}`,
          description,
          showButtons: ['previous', 'next'],
          disableButtons: [
            ...(index === 0 ? ['previous' as const] : []),
            ...(!complete && index !== 7 ? ['next' as const] : []),
          ],
          prevBtnText: 'Back',
          nextBtnText: index === 7 ? 'Finish practice' : 'Next',
          onNextClick: next,
          onPrevClick: back,
        },
      });
      if (focus?.isConnected && !host.contains(focus)) focus.focus({ preventScroll: true });
      else popover?.wrapper.focus({ preventScroll: true });
      host.scrollTop = 0;
    },
    destroy() {
      document.getElementById('tour-actions')!.replaceChildren();
      presenter.destroy();
      popover = undefined;
    },
  };
}
