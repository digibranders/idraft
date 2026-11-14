import { describe, expect, it } from 'vitest';

import { MOVE_COMMANDS, moveTargetIndex, type MoveCommand } from './move-menu';

/** The four commands at one place: [earlier, later, start, end]. */
function targets(index: number, total: number): (number | null)[] {
  return MOVE_COMMANDS.map((command: MoveCommand) => moveTargetIndex(command, index, total));
}

describe('moveTargetIndex', () => {
  it('lists the commands in the order of the menu', () => {
    expect(MOVE_COMMANDS).toEqual(['earlier', 'later', 'start', 'end']);
  });

  it('cannot move the first card earlier or to the start', () => {
    expect(targets(0, 8)).toEqual([null, 1, null, 7]);
  });

  it('moves a card in the middle one place, or to either end', () => {
    expect(targets(3, 8)).toEqual([2, 4, 0, 7]);
  });

  it('cannot move the last card later or to the end', () => {
    expect(targets(7, 8)).toEqual([6, null, 0, null]);
  });

  it('cannot move the only card anywhere', () => {
    expect(targets(0, 1)).toEqual([null, null, null, null]);
  });

  it('moves the second card to the start and the last but one to the end', () => {
    expect(targets(1, 3)).toEqual([0, 2, 0, 2]);
    expect(targets(1, 2)).toEqual([0, null, 0, null]);
    expect(targets(0, 2)).toEqual([null, 1, null, 1]);
  });

  it('answers null for a place that is not in the list', () => {
    expect(targets(-1, 4)).toEqual([null, null, null, null]);
    expect(targets(4, 4)).toEqual([null, null, null, null]);
    expect(targets(0, 0)).toEqual([null, null, null, null]);
  });
});
