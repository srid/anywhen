import { expect, test } from "bun:test";
import { nextInCycle, STATUS_CYCLE, TaskStatusSchema } from "./schemas";

test("STATUS_CYCLE covers every TaskStatus value exactly once", () => {
  expect([...STATUS_CYCLE].sort()).toEqual([...TaskStatusSchema.options].sort());
  expect(new Set(STATUS_CYCLE).size).toBe(STATUS_CYCLE.length);
});

test("nextInCycle walks todo → doing → done → todo", () => {
  expect(nextInCycle("todo")).toBe("doing");
  expect(nextInCycle("doing")).toBe("done");
  expect(nextInCycle("done")).toBe("todo");
});
