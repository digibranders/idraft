/**
 * A promise a test settles from outside: an answer held until the test says so, in place of a delay that
 * hopes to be long enough. Release it before the test ends, or a request stays unanswered.
 */
export function gate(): { promise: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}
