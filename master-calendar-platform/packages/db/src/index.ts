export * from "./generated/prisma/client.js";
export { createPrismaClient } from "./client.js";
export { createWorkspaceFromTemplate, type CreateWorkspaceInput } from "./workspace.js";
export { getVerticalTemplate, verticalTemplates, type VerticalTemplate } from "../seed-templates/index.js";
