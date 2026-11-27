'use client';

import type { Route } from 'next';
import type { ReactElement } from 'react';

import { NoteChip } from './note-chip';
import { splitNoteText, type NoteMention } from '@/lib/pages/note-mentions';

export interface NoteTextProps {
  body: string;
  mentions: readonly NoteMention[];
  onOpenPage: (urlId: string) => void;
  issueHref: (checkId: string) => Route | null;
}

/**
 * The text of a saved note with its mentions as chips. Everything is a React text child or an element built here, so
 * markup in the body or in a label is drawn as the characters it is made of; line breaks stay.
 */
export function NoteText({ body, mentions, onOpenPage, issueHref }: NoteTextProps): ReactElement {
  return (
    <p className="pl-10 type-body break-words whitespace-pre-wrap text-foreground">
      {splitNoteText(body, mentions).map((part, index) =>
        part.kind === 'text' ? (
          part.text
        ) : (
          // Parts are cut from the body and never reorder, so the position is the identity
          <NoteChip key={index} mention={part.mention} onOpenPage={onOpenPage} issueHref={issueHref} />
        ),
      )}
    </p>
  );
}
