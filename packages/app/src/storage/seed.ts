// Sample-data seeder for `just dev`. Gated at the server boot site by
// `ANYWHEN_SEED_SAMPLE_DATA=1` — the dev recipe sets it; cucumber does
// not, so the e2e suite remains driven by `__test__reset` between
// scenarios. No-op when any tasks already exist, so re-running
// `just dev` against a populated DB never clobbers user data.
//
// Writes through the store's verbs (`add`, `toggle`) rather than raw SQL
// so positions, timestamps, and FK invariants stay identical to what
// the running app produces.

import type { TaskStore } from "./tasks";

export async function seedSampleData(store: TaskStore): Promise<void> {
  const existing = await store.list();
  if (existing.length > 0) return;

  const inbox = await store.add({ title: "Inbox", parentId: null });
  await store.add({ title: "Reply to Q3 planning email", parentId: inbox.id });
  await store.add({ title: "Schedule dentist appointment", parentId: inbox.id });

  const anywhen = await store.add({ title: "anywhen", parentId: null });
  const detailPanel = await store.add({ title: "Detail panel", parentId: anywhen.id });
  await store.add({ title: "Body editor (markdown)", parentId: detailPanel.id });
  await store.add({ title: "Due dates & tags", parentId: detailPanel.id });
  await store.add({ title: "Filter atoms (atom: tag: due:)", parentId: anywhen.id });

  const reading = await store.add({ title: "Reading", parentId: null });
  const simpleMadeEasy = await store.add({
    title: "Simple Made Easy — Rich Hickey",
    parentId: reading.id,
  });
  await store.add({ title: "Righting Software — Juval Lowy", parentId: reading.id });
  await store.toggle(simpleMadeEasy.id);

  const weekend = await store.add({ title: "Weekend", parentId: null });
  const groceries = await store.add({ title: "Groceries", parentId: weekend.id });
  await store.add({ title: "Milk", parentId: groceries.id });
  const bread = await store.add({ title: "Bread", parentId: groceries.id });
  await store.add({ title: "Eggs", parentId: groceries.id });
  await store.add({ title: "Fix the bike puncture", parentId: weekend.id });
  await store.toggle(bread.id);
}
