import { z } from "zod";

export const TaskIdSchema = z.string().min(1);
export const TaskStatusSchema = z.enum(["todo", "done"]);

export const TaskSchema = z.object({
  id: TaskIdSchema,
  parentId: TaskIdSchema.nullable(),
  title: z.string(),
  status: TaskStatusSchema,
  position: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const AddTaskInputSchema = z.object({
  title: z.string().min(1),
  parentId: TaskIdSchema.nullable(),
});
