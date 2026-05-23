// In-process Channel<T> factory for the surface. The wire-level snapshot
// path (`tasks.keys`, `tasks.get`) only needs subscribe+publish to broadcast
// inside this process — anywhen is single-user local, so cross-process pub/sub
// (Redis, @orpc/experimental-publisher backed by WebSocket) is overkill.
//
// Each named channel has its own pool of waiting subscribers. publish() wakes
// every subscriber's pending pull with the new value; subscribers detach on
// AbortSignal so a closed WebSocket cleans up its key-set + per-key streams.

import type { Channel } from "@kolu/surface/server";

type Waiter<T> = {
  resolve: (result: IteratorResult<T>) => void;
  reject: (err: unknown) => void;
};

const makeChannel = <T>(): Channel<T> => {
  // Queued items for subscribers that haven't pulled yet, plus the set of
  // waiters currently awaiting a value. publish fans into both: hand the
  // value to each waiter directly, then push onto each subscriber's queue
  // for the next pull. A subscriber's queue stays per-subscriber so two
  // subscribers don't race for the same publish.
  const subscribers = new Set<{ queue: T[]; waiter: Waiter<T> | null }>();

  const publish = (value: T): void => {
    for (const sub of subscribers) {
      if (sub.waiter) {
        const { resolve } = sub.waiter;
        sub.waiter = null;
        resolve({ value, done: false });
      } else {
        sub.queue.push(value);
      }
    }
  };

  const subscribe = (signal: AbortSignal | undefined): AsyncIterable<T> => {
    const sub: { queue: T[]; waiter: Waiter<T> | null } = { queue: [], waiter: null };
    subscribers.add(sub);

    const detach = (reason?: unknown): void => {
      subscribers.delete(sub);
      if (sub.waiter) {
        const w = sub.waiter;
        sub.waiter = null;
        w.resolve({ value: undefined as never, done: true });
      }
      if (reason !== undefined) {
        // Resurrect waiter rejection path — currently no caller relies on it.
      }
    };

    const onAbort = () => detach();
    signal?.addEventListener("abort", onAbort);

    const iterator: AsyncIterator<T> = {
      next(): Promise<IteratorResult<T>> {
        if (signal?.aborted) return Promise.resolve({ value: undefined as never, done: true });
        if (sub.queue.length > 0) {
          const value = sub.queue.shift() as T;
          return Promise.resolve({ value, done: false });
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          sub.waiter = { resolve, reject };
        });
      },
      return(): Promise<IteratorResult<T>> {
        signal?.removeEventListener("abort", onAbort);
        detach();
        return Promise.resolve({ value: undefined as never, done: true });
      },
    };
    return { [Symbol.asyncIterator]: () => iterator };
  };

  return {
    publish,
    subscribe,
    consume: ({ onEvent, onError }) => {
      const controller = new AbortController();
      void (async () => {
        try {
          for await (const value of subscribe(controller.signal)) onEvent(value);
        } catch (err) {
          if (!controller.signal.aborted) onError(err);
        }
      })();
      return () => controller.abort();
    },
  };
};

// Channel factory keyed by name. implementSurface calls this once per
// channel name (e.g. "tasks:keys", "tasks:<uuid>"); the named-cache ensures
// publisher and subscriber paths for the same name see the same channel.
export const channelFactory = (): (<T>(name: string) => Channel<T>) => {
  const channels = new Map<string, Channel<unknown>>();
  return <T>(name: string): Channel<T> => {
    const existing = channels.get(name);
    if (existing) return existing as Channel<T>;
    const created = makeChannel<T>();
    channels.set(name, created as Channel<unknown>);
    return created;
  };
};
