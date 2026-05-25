// RPC error policy for the client. Two variants exist because the policy
// applies only to writes: `callWrite` clears the error toast on success —
// a successful write implies the prior failure is resolved. `callQuery`
// captures failures but does not touch a stale toast: a successful read
// (e.g. export) shouldn't silently erase an unrelated error the user is
// still looking at.
//
// `confirmDestructive` is the single receptacle for "are you sure?" before
// a write that cascades or wipes. Native `window.confirm` is the simplest
// accessible blocker today; when the app eventually grows an in-app modal,
// only this body changes — every destructive call site already speaks
// through the name.

export type SetError = (e: string | null) => void;

export type CallWrite = <T>(fn: () => Promise<T>) => Promise<T | undefined>;
export type CallQuery = <T>(fn: () => Promise<T>) => Promise<T | undefined>;

export const createRpc = (setError: SetError): { callWrite: CallWrite; callQuery: CallQuery } => {
  const captureError = (err: unknown): undefined => {
    setError(err instanceof Error ? err.message : String(err));
    return undefined;
  };

  const callWrite: CallWrite = async (fn) => {
    try {
      const result = await fn();
      setError(null);
      return result;
    } catch (err) {
      return captureError(err);
    }
  };

  const callQuery: CallQuery = async (fn) => {
    try {
      return await fn();
    } catch (err) {
      return captureError(err);
    }
  };

  return { callWrite, callQuery };
};

export const confirmDestructive = (message: string): boolean => window.confirm(message);
