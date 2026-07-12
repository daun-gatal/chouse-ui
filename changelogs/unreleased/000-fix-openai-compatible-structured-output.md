type: patch

### Fixed
- **AI structured output on OpenAI-compatible models** — forced tool-calling instead of OpenAI's strict `json_schema` response format when the resolved model is a non-native `ChatOpenAI` instance (covers `openai-compatible` providers like DeepSeek/Qwen proxies). Fixes "Chouse AI could not complete 'recommend-health-promise'" and similar generic failures on complex-schema capabilities when using third-party OpenAI-compatible endpoints.
