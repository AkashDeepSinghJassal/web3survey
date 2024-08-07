import z from "zod";

const createTaskInput = z.object({
    options: z.array(z.object({
        imageUrl: z.string(),
    })).min(2),
    title: z.string(),
    signature: z.string()
});

const createSubmissionInput = z.object({
    taskId: z.string(),
    selection: z.string(),
});

export { createTaskInput, createSubmissionInput }