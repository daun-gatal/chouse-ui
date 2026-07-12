type: minor

### Added
- **Configurable AI model runtime parameters** — admins can now tune per Provider Model: sampling (temperature, top-p, top-k, frequency/presence penalties), output limits (max tokens, stop sequences, verbosity), reasoning (effort level, thinking budgets), reliability (retries, request timeout), and the agent runtime (recursion limit, run timeout), plus an advanced escape hatch for extra provider kwargs. Fields are provider-aware (OpenAI, Anthropic, Google, OpenAI-compatible) with validation on both the form and the API, and take effect on the next AI run without a restart.

### Fixed
- **Google provider base URL** — custom base URLs configured on Google providers are now actually passed to the Gemini client.
- **Recursion-limit errors** — LangGraph "Recursion limit reached" failures now surface a friendly message pointing at the configurable Provider Model recursion limit instead of a generic provider error.
