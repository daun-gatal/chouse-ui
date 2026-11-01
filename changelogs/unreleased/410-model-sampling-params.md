type: patch

### Fixed
- **Sampling settings on newer models** — AI requests no longer fail with "`temperature` is deprecated for this model" on Claude models after 4.6 (such as Claude Haiku 5.5), or with an unsupported-temperature error on OpenAI reasoning models (o-series, GPT-5). Temperature, top P, top K and the penalties are now left out for those models, including when they are reached through Bedrock, OpenRouter or an OpenAI-compatible endpoint; other models keep the temperature-0 default
