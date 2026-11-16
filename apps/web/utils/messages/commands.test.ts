import { expect, it } from "vitest";
import { matchingMessageCommands } from "./commands";
it("offers commands only from the first character and filters command prefixes", () => {
  expect(matchingMessageCommands("/").map((item) => item.command)).toEqual([
    "/add",
    "/invite",
  ]);
  expect(matchingMessageCommands("/I")[0].command).toBe("/invite");
  for (const text of ["text /", " /", "/add text", "/unknown", ""])
    expect(matchingMessageCommands(text)).toEqual([]);
});
