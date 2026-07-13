type: minor

### Added
- **Expanded AI providers** — Chouse AI now supports Azure OpenAI, Groq, Mistral, Cohere, Ollama, xAI (Grok), DeepSeek, Cerebras, and AWS Bedrock as first-class provider types, plus preset OpenAI-compatible endpoints for Fireworks AI, Together AI, and OpenRouter. Each provider exposes only the runtime parameters its SDK actually supports, Ollama needs no API key, and Bedrock is configured with dedicated AWS region/access-key fields (stored encrypted).
