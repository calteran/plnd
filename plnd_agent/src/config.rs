/// Configuration for a single LLM endpoint (provider, model, credentials).
#[derive(Debug, serde::Deserialize, Clone, Default)]
pub struct LlmModelConfig {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    pub max_tokens: u32,
}

/// Dual-model LLM configuration: a fast model for low-latency tasks and a
/// capable model for complex reasoning.
#[derive(Debug, serde::Deserialize, Clone, Default)]
pub struct LlmConfig {
    pub fast: LlmModelConfig,
    pub capable: LlmModelConfig,
}
