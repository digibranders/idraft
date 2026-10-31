'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CaretDown, Check } from '@phosphor-icons/react';

type SelectProps = {
  id: string;
  name: string;
  options: readonly string[];
  defaultValue?: string;
};

/**
 * A listbox in the site's own style, replacing the native picker. The chosen value is mirrored into a hidden
 * input so the surrounding form reads it like any field. Keyboard: arrows, Home, End, Enter, Space, Escape, and
 * typing the first letter of an option.
 */
export function Select({ id, name, options, defaultValue }: SelectProps) {
  const listId = useId();
  const [value, setValue] = useState(defaultValue ?? options[0] ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const openList = () => {
    setActive(Math.max(0, options.indexOf(value)));
    setOpen(true);
  };

  const choose = (option: string) => {
    setValue(option);
    setOpen(false);
    button.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const last = options.length - 1;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => Math.min(last, index + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(last);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(options[active] ?? value);
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        if (event.key.length === 1) {
          const from = options.findIndex((option, index) => index > active && option.toLowerCase().startsWith(event.key.toLowerCase()));
          const match = from >= 0 ? from : options.findIndex((option) => option.toLowerCase().startsWith(event.key.toLowerCase()));
          if (match >= 0) setActive(match);
        }
    }
  };

  return (
    <div ref={root} className="relative">
      <input type="hidden" name={name} value={value} />
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className="flex w-full items-center justify-between gap-3 rounded-2xl bg-surface px-4 py-3.5 text-left text-[15px] text-ink ring-1 ring-ink/15 transition duration-300 hover:ring-ink/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt aria-expanded:ring-2 aria-expanded:ring-cobalt"
      >
        <span>{value}</span>
        <CaretDown size={16} weight="bold" aria-hidden="true" className={`shrink-0 text-ink-3 transition duration-500 ease-heavy ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open ? (
          <motion.ul
            id={listId}
            role="listbox"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            className="absolute inset-x-0 top-full z-20 mt-2 origin-top rounded-2xl bg-surface p-1.5 shadow-lift ring-1 ring-ink/[0.08]"
          >
            {options.map((option, index) => {
              const selected = option === value;
              return (
                // Options are operated from the combobox button (aria-activedescendant), so they need no key handler of their own.
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events
                <li
                  key={option}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={selected}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                  className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-[15px] transition duration-150 ${index === active ? 'bg-wash text-ink' : 'text-ink-2'} ${selected ? 'font-medium' : ''}`}
                >
                  {option}
                  {selected ? <Check size={16} weight="bold" aria-hidden="true" className="text-cobalt" /> : null}
                </li>
              );
            })}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
