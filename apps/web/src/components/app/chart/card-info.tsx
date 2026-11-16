'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, use, useRef, useState, type ReactElement, type ReactNode, type RefObject } from 'react';

import { Button, type ButtonProps } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Popover } from '@/components/ui/popover';
import { Tooltip } from '@/components/ui/tooltip';

const CardInfoContext = createContext(false);

/**
 * Switches the charts below it to info mode: the footnote is not printed under a card but sits behind an "i" button
 * at the end of the title row. Without it every chart prints its footnote, as before.
 */
export function CardInfoProvider({ children }: { children: ReactNode }): ReactElement {
  return <CardInfoContext value>{children}</CardInfoContext>;
}

/** Whether the charts here keep their footnote behind an "i" button. */
export function useCardInfo(): boolean {
  return use(CardInfoContext);
}

/** What a card says about itself: what it shows, then how it is counted. */
export interface CardInfo {
  what: ReactNode;
  how: ReactNode;
}

/** Whether a footnote has anything to say: an empty string, `false` and `null` do not. */
export const hasFootnote = (footnote: ReactNode): boolean =>
  footnote !== undefined && footnote !== null && footnote !== false && footnote !== '';

/** The button that carries the props the popover gives its trigger on to the tooltip's child. */
function InfoTrigger({
  label,
  tip,
  tipOff,
  readTip,
  ...props
}: ButtonProps & { label: string; tip: string; tipOff: boolean; readTip: () => boolean }): ReactElement {
  return (
    // The text is in the document already (hidden), so the tooltip is for the eye only
    <Tooltip content={tip} purpose="label" side="bottom" disabled={tipOff} shouldOpen={readTip}>
      <Button data-slot="card-info" variant="ghost" size="icon-xs" aria-label={label} {...props}>
        <Icon icon={Info} size="sm" />
      </Button>
    </Tooltip>
  );
}

export interface CardInfoButtonProps {
  title: string;
  /** What the card prints in its footnote; it is also rendered, hidden, by the frame. Shown only when `info` is not given. */
  footnote?: ReactNode;
  /** The hidden element that holds the footnote, which the tooltip reads its text from when there is no `info`. */
  footnoteRef?: RefObject<HTMLElement | null>;
  /** What the card shows and how it is counted: two paragraphs in the tooltip and the popover, in place of the footnote. */
  info?: CardInfo | undefined;
}

/**
 * The "i" button of a card: hover or keyboard focus shows the text in a tooltip, a click opens it in a small popover,
 * which is how touch reaches it. The tooltip stays out of the way while the popover is open. With `info` the text is
 * what the card shows, then a paragraph on how it is counted; without it, the footnote.
 */
export function CardInfoButton({ title, footnote, footnoteRef, info }: CardInfoButtonProps): ReactElement {
  const t = useTranslations('chart.info');
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState('');
  const infoRef = useRef<HTMLSpanElement>(null);
  // The text can change with the data, so it is read each time the tooltip is about to open
  const readTip = (): boolean => {
    const source = info === undefined ? footnoteRef?.current : infoRef.current;
    const text = source?.textContent.trim() ?? '';
    setTip(text);
    return text !== '';
  };
  const label = t('about', { title });
  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        aria-label={label}
        padding="text"
        align="end"
        trigger={<InfoTrigger label={label} tip={tip} tipOff={open} readTip={readTip} />}
      >
        {info === undefined ? (
          <div className="type-body text-foreground-secondary">{footnote}</div>
        ) : (
          <div className="type-body text-foreground-secondary">
            <p className="text-foreground">{info.what}</p>
            <p className="mt-2">
              <strong className="type-body-strong text-foreground">{t('how')}</strong> {info.how}
            </p>
          </div>
        )}
      </Popover>
      {info === undefined ? null : (
        // The words are in the document for the tooltip to read; the popover shows them to the eye
        <span ref={infoRef} className="sr-only">
          {info.what} {t('how')} {info.how}
        </span>
      )}
    </>
  );
}
