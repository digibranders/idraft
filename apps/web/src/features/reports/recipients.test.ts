import { describe, expect, it } from 'vitest';

import { parseRecipients } from './recipients';

describe('parseRecipients', () => {
  it('splits on lines, spaces, commas and semicolons, lower-cases and lists each address once', () => {
    const parsed = parseRecipients(' Anita@Client.com,\nops@client.com; anita@client.com  board@client.com ');
    expect(parsed.problem).toBeNull();
    expect(parsed.addresses).toEqual(['anita@client.com', 'ops@client.com', 'board@client.com']);
  });

  it('asks for at least one address', () => {
    expect(parseRecipients('  \n ').problem).toEqual({ kind: 'empty' });
  });

  it('refuses more than ten addresses', () => {
    const eleven = Array.from({ length: 11 }, (_, index) => `user${String(index)}@client.com`).join('\n');
    expect(parseRecipients(eleven).problem).toEqual({ kind: 'tooMany' });
    expect(parseRecipients(eleven.split('\n').slice(0, 10).join('\n')).problem).toBeNull();
  });

  it('names the first thing that is not an address', () => {
    expect(parseRecipients('a@client.com bad address').problem).toEqual({ kind: 'invalid', address: 'bad' });
    expect(parseRecipients('no-dot@client').problem).toEqual({ kind: 'invalid', address: 'no-dot@client' });
  });
});
