import { expect, it } from "vitest";
import { buildProgress, progressFromBuildLine } from "./progress.mjs";

it("tracks real compiler milestones and page generation counts", () => {
  const stages = [
    progressFromBuildLine("Creating an optimized production build ..."),
    progressFromBuildLine("Running TypeScript ..."),
    progressFromBuildLine(
      "Generating static pages using 8 workers (0/120) ...",
    ),
    progressFromBuildLine(
      "Generating static pages using 8 workers (60/120) ...",
    ),
    progressFromBuildLine(
      "Generating static pages using 8 workers (120/120) ...",
    ),
    buildProgress("package"),
    buildProgress("check"),
    buildProgress("install"),
  ];
  expect(stages.map((stage) => stage?.percent)).toEqual([
    14, 29, 43, 50, 57, 57, 71, 86,
  ]);
  expect(stages[3]).toMatchObject({
    stage: "pages",
    detail: "60 / 120 pages",
    step: 4,
    steps: 7,
  });
  expect(progressFromBuildLine("Checking validity of types ...")?.stage).toBe(
    "types",
  );
  expect(
    progressFromBuildLine("Collecting page data using 8 workers ...")?.stage,
  ).toBe("pages");
});
it("does not invent progress for unrelated output and clamps page counts", () => {
  expect(progressFromBuildLine("Route (app) Size First Load JS")).toBeNull();
  expect(buildProgress("pages", 200, 120).detail).toBe("120 / 120 pages");
  expect(buildProgress("pages", -1, 120).percent).toBe(43);
  expect(buildProgress("pages", 0, 0).percent).toBe(43);
});
