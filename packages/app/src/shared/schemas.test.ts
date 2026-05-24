import { expect, test } from "bun:test";
import { nextInCycle } from "./schemas";

// Walking three steps from "todo" returns to "todo", which both (a) names
// the cycle's order at the smallest meaningful site and (b) exhaustively
// touches every TaskStatus value — `Record<TaskStatus, TaskStatus>` in
// schemas.ts already enforces full key coverage at the type level, so no
// separate coverage assertion is needed here.
test("nextInCycle walks todo → doing → done → todo", () => {
  expect(nextInCycle("todo")).toBe("doing");
  expect(nextInCycle("doing")).toBe("done");
  expect(nextInCycle("done")).toBe("todo");
});
