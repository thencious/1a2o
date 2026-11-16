export const messageCommands = [
  {
    command: "/add",
    description: "Save contact details from the last 100 lines",
  },
  {
    command: "/invite",
    description: "Prepare a meeting invitation from the last 50 lines",
  },
];
export const globalSlashCommands = [
  { command: "/summarize", description: "Summarize this item or workspace" },
  { command: "/find", description: "Find something in 1a2o" },
  { command: "/help", description: "Ask what Chat can do here" },
];
export function matchingMessageCommands(text: string) {
  return /^\/[^\s]*$/.test(text)
    ? messageCommands.filter((item) =>
        item.command.startsWith(text.toLowerCase()),
      )
    : [];
}
