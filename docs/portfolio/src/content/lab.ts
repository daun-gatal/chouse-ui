/**
 * The "Run your own lab" link: opens a private copy of CHouse UI with sample
 * data in the visitor's own GitHub Codespace (.devcontainer/lab, ADR 0032).
 *
 * The landing page and the docs import it from here. The README's Codespaces
 * badge links the same URL; content.test.ts fails if the two drift apart or
 * the devcontainer file moves.
 */

/** Path of the lab's devcontainer, relative to the repository root. */
export const LAB_DEVCONTAINER_PATH = ".devcontainer/lab/devcontainer.json";

/** Opens the "create codespace" page for the lab, with the quick-start flow. */
export const LAB_URL = `https://codespaces.new/daun-gatal/chouse-ui?devcontainer_path=${encodeURIComponent(LAB_DEVCONTAINER_PATH)}&quickstart=1`;

/** What the visitor needs to know before clicking. */
export const LAB_NOTE = "Your own free GitHub Codespace · about 3 min";
