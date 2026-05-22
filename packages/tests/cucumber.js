// Mirrors kolu's cucumber.js shape: a single `ui` profile, tags via
// CUCUMBER_TAGS env, optional parallelism via CUCUMBER_PARALLEL. Reports
// go under reports/.
const parallel = parseInt(process.env.CUCUMBER_PARALLEL || "1", 10);

const cliHasFeatureArgs = process.argv.slice(2).some((a) => /\.feature(?::\d+)*$/.test(a));

const tags = process.env.CUCUMBER_TAGS || "not @skip";

export const ui = {
  ...(!cliHasFeatureArgs && { paths: ["features/**/*.feature"] }),
  import: ["step_definitions/**/*.ts", "support/**/*.ts"],
  tags,
  format: ["progress-bar", "pretty:/dev/stderr", "html:reports/report.html"],
  formatOptions: { snippetInterface: "async-await" },
  ...(parallel > 1 && { parallel }),
};

export default {};
