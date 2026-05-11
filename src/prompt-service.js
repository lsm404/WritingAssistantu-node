import { prisma } from "./prisma.js";

export async function getUserPrompts(userId) {
  const prompts = await prisma.prompt.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return prompts;
}

export async function createUserPrompt(userId, payload) {
  if (!payload.name || !payload.content) {
    throw new Error("NAME_AND_CONTENT_REQUIRED");
  }

  const prompt = await prisma.prompt.create({
    data: {
      userId,
      name: payload.name,
      content: payload.content,
    },
  });
  return prompt;
}

export async function updateUserPrompt(userId, promptId, payload) {
  if (!payload.name || !payload.content) {
    throw new Error("NAME_AND_CONTENT_REQUIRED");
  }

  const prompt = await prisma.prompt.findFirst({
    where: { id: promptId, userId },
  });

  if (!prompt) {
    throw new Error("PROMPT_NOT_FOUND");
  }

  const updated = await prisma.prompt.update({
    where: { id: promptId },
    data: {
      name: payload.name,
      content: payload.content,
    },
  });
  return updated;
}

export async function deleteUserPrompt(userId, promptId) {
  const prompt = await prisma.prompt.findFirst({
    where: { id: promptId, userId },
  });

  if (!prompt) {
    throw new Error("PROMPT_NOT_FOUND");
  }

  await prisma.prompt.delete({
    where: { id: promptId },
  });
  return true;
}
