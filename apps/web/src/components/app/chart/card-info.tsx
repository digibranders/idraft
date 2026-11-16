'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { createContext, use, useState, type ReactElement, type ReactNode, type RefObject } from 'react';

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

/** The button that carries the props the popover gives its trigger on to the tooltip's child. */
function InfoTrigger({
  label,
  tip,
  tipOff,
  readTip,
  ...props
}: ButtonProps & { label: string; tip: string; tipOff: boolean; readTip: () => boolean }): ReactElement {
  return (
    // The text is in the document already (the visually hidden footnote), so the tooltip is for the eye only
    <Tooltip content={tip} purpose="label" side="bottom" disabled={tipOff} shouldOpen={readTip}>
      <Button data-slot="card-info" variant="ghost" size="icon-xs" aria-label={label} {...props}>
        <Icon icon={Info} size="sm" />
      </Button>
    </Tooltip>
  );
}

export interface CardInfoButtonProps {
  title: string;
  /** What the card prints in its footnote; it is also rendered, hidden, by the frame. */
  footnote: ReactNode;
  /** The hidden element that holds the footnote, which the tooltip reads its text from. */
  footnoteRef: RefObject<HTMLElement | null>;
}

/**
 * The "i" button of a card: hover or keyboard focus shows the footnote in a tooltip, a click opens it in a small
 * popover, which is how touch reaches it. The tooltip stays out of the way while the popover is open.
 */
export function CardInfoButton({ title, footnote, footnoteRef }: CardInfoButtonProps): ReactElement {
  const t = useTranslations('chart.info');
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState('');
  // The footnote can change with the data, so its text is read each time the tooltip is about to open
  const readTip = (): boolean => {
    const text = footnoteRef.current?.textContent.trim() ?? '';
    setTip(text);
    return text !== '';
  };
  const label = t('about', { title });
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      aria-label={label}
      padding="text"
      align="end"
      trigger={<InfoTrigger label={label} tip={tip} tipOff={open} readTip={readTip} />}
    >
      <div className="type-body text-foreground-secondary">{footnote}</div>
    </Popover>
  );
}
