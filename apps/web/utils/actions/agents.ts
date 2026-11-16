"use server";
import { actionClientUser } from "./safe-action";
import { agentCommand } from "./agents.validation";
import { localAgentsRequest } from "@/utils/agents/service";
export const agentCommandAction = actionClientUser
  .metadata({ name: "localAgentCommand" })
  .inputSchema(agentCommand)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    localAgentsRequest(userId, "/command", parsedInput),
  );
