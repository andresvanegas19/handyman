import { z } from "zod";

export const editableGuide = z.object({
  slug: z.string().min(1), title: z.string().min(3), summary: z.string().min(10),
  category: z.enum(["Doors & windows", "Furniture", "Plumbing"]),
  difficulty: z.literal("Easy"), duration: z.string().min(1),
  symptoms: z.array(z.string()), tools: z.array(z.string()), prerequisites: z.array(z.string()),
  stopConditions: z.array(z.string()),
  steps: z.array(z.object({
    title:z.string(),description:z.string(),partIds:z.array(z.string()),
    visual:z.object({
      location:z.string().trim().min(1).max(800),lookFor:z.string().trim().min(1).max(800),
      motion:z.string().trim().min(1).max(800),force:z.string().trim().min(1).max(800),
      risk:z.string().trim().min(1).max(800),check:z.string().trim().min(1).max(800),
    }).optional(),
  })),
  assemblyKind: z.enum(["door","hinge","knob","aerator"]).optional(),
  status: z.literal("draft"), version: z.number().int().positive(),
});
export const editableParts = z.array(z.object({
  id:z.string(),label:z.string(),description:z.string(),nodeNames:z.array(z.string()),
  explodeOffset:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]),
}));
