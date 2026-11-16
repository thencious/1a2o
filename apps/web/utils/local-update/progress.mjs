const labels = {
  prepare: "Preparing build",
  compile: "Compiling",
  types: "Checking types",
  pages: "Generating pages",
  package: "Packaging update",
  check: "Checking update",
  install: "Installing update",
};

/** @param {keyof typeof labels} stage @param {number} [completed] @param {number} [total] */
export function buildProgress(stage, completed, total) {
  const step = Object.keys(labels).indexOf(stage) + 1;
  const fraction =
    total && completed !== undefined
      ? Math.max(0, Math.min(1, completed / total))
      : 0;
  return {
    stage,
    label: labels[stage],
    step,
    steps: Object.keys(labels).length,
    percent: Math.round(
      ((step - 1 + fraction) / Object.keys(labels).length) * 100,
    ),
    detail:
      total && completed !== undefined
        ? `${Math.min(Math.max(0, completed), total)} / ${total} pages`
        : null,
  };
}

/** @param {string} line */
export function progressFromBuildLine(line) {
  if (line.includes("Creating an optimized production build"))
    return buildProgress("compile");
  if (
    line.includes("Running TypeScript") ||
    line.includes("Checking validity of types")
  )
    return buildProgress("types");
  const pages = line.match(/Generating static pages.*\((\d+)\s*\/\s*(\d+)\)/);
  if (pages) return buildProgress("pages", Number(pages[1]), Number(pages[2]));
  if (
    line.includes("Collecting page data") ||
    line.includes("Generating static pages")
  )
    return buildProgress("pages");
  return null;
}
