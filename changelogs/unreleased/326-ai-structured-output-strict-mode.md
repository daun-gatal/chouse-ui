type: patch

### Fixed
- **AI structured output on strict providers** — schemas for the Data Health promise recommendation, both query optimizers, and the fleet scan used optional fields that OpenAI-compatible providers reject in strict structured-output mode, so that fallback strategy failed on every call before a request was even sent. Optional output fields are now nullable.
- **Schema-invalid AI responses** — when a model returns JSON that violates the output schema, Chouse AI now re-prompts once with the specific validation errors instead of failing the run outright.
