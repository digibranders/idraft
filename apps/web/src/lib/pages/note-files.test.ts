import { describe, expect, it } from 'vitest';

import { NOTE_FILES_MAX, NOTE_FILE_MAX_BYTES, checkNewFiles } from './note-files';

const file = (name: string, type: string, size = 10): File => {
  const made = new File(['x'], name, { type });
  // The bytes are not needed, only the size the browser reports
  Object.defineProperty(made, 'size', { value: size });
  return made;
};

describe('the limits', () => {
  it('are 5 files of 10 MB', () => {
    expect(NOTE_FILES_MAX).toBe(5);
    expect(NOTE_FILE_MAX_BYTES).toBe(10 * 1024 * 1024);
  });
});

describe('checkNewFiles', () => {
  it('accepts each of the seven types by its type', () => {
    const types = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'text/csv'];
    for (const type of types) {
      const { accepted, refused } = checkNewFiles(0, [file('a.bin', type)]);
      expect(accepted).toHaveLength(1);
      expect(refused).toEqual([]);
    }
  });

  it('refuses a type outside the seven, whatever the extension', () => {
    const odd = file('logo.png', 'image/svg+xml');
    const zip = file('report.zip', 'application/zip');
    const { accepted, refused } = checkNewFiles(0, [odd, zip]);
    expect(accepted).toEqual([]);
    expect(refused).toEqual([
      { kind: 'type', name: 'logo.png' },
      { kind: 'type', name: 'report.zip' },
    ]);
  });

  it('falls back to the extension when the type is empty, a generic one or the one Excel gives a CSV', () => {
    for (const type of ['', 'application/octet-stream', 'application/vnd.ms-excel']) {
      for (const name of ['a.csv', 'a.TXT', 'a.png', 'a.jpg', 'a.JPEG', 'a.gif', 'a.webp', 'a.pdf']) {
        expect(checkNewFiles(0, [file(name, type)]).accepted).toHaveLength(1);
      }
      expect(checkNewFiles(0, [file('a.zip', type)]).refused).toEqual([{ kind: 'type', name: 'a.zip' }]);
      expect(checkNewFiles(0, [file('noextension', type)]).refused).toEqual([{ kind: 'type', name: 'noextension' }]);
    }
  });

  it('does not let an extension rescue a named, wrong type', () => {
    expect(checkNewFiles(0, [file('a.csv', 'application/zip')]).refused).toHaveLength(1);
  });

  it('checks the size: 10 MB passes, one byte more does not', () => {
    const edge = file('a.pdf', 'application/pdf', NOTE_FILE_MAX_BYTES);
    const over = file('scan.pdf', 'application/pdf', NOTE_FILE_MAX_BYTES + 1);
    const { accepted, refused } = checkNewFiles(0, [edge, over]);
    expect(accepted).toEqual([edge]);
    expect(refused).toEqual([{ kind: 'size', name: 'scan.pdf' }]);
  });

  it('stops accepting at 5 counting the files already held, with one count refusal', () => {
    const files = ['1', '2', '3', '4'].map((name) => file(`${name}.png`, 'image/png'));
    const { accepted, refused } = checkNewFiles(3, files);
    expect(accepted).toEqual(files.slice(0, 2));
    expect(refused).toEqual([{ kind: 'count' }]);
  });

  it('refuses everything with a count refusal when the box is full', () => {
    const { accepted, refused } = checkNewFiles(5, [file('a.png', 'image/png')]);
    expect(accepted).toEqual([]);
    expect(refused).toEqual([{ kind: 'count' }]);
  });

  it('keeps the refusals in the order the files came', () => {
    const files = [
      file('a.png', 'image/png'),
      file('big.pdf', 'application/pdf', NOTE_FILE_MAX_BYTES + 1),
      file('b.zip', 'application/zip'),
    ];
    expect(checkNewFiles(0, files).refused).toEqual([
      { kind: 'size', name: 'big.pdf' },
      { kind: 'type', name: 'b.zip' },
    ]);
  });

  it('is not thrown by nothing, a negative count or an odd count', () => {
    expect(checkNewFiles(0, [])).toEqual({ accepted: [], refused: [] });
    expect(checkNewFiles(-3, [file('a.png', 'image/png')]).accepted).toHaveLength(1);
    expect(checkNewFiles(Number.NaN, [file('a.png', 'image/png')]).accepted).toHaveLength(1);
  });
});
