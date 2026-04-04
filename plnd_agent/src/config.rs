/// Default value for `max_iterations` when absent from config.
fn default_max_iterations() -> u32 {
    10
}

/// Configuration for a single LLM endpoint (provider, model, credentials).
#[derive(Debug, serde::Deserialize, Clone, Default)]
pub struct LlmModelConfig {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
}

/// Dual-model LLM configuration: a fast model for low-latency tasks and a
/// capable model for complex reasoning.
#[derive(Debug, serde::Deserialize, Clone, Default)]
pub struct LlmConfig {
    pub fast: LlmModelConfig,
    pub capable: LlmModelConfig,
}

fn default_max_tokens() -> u32 {
    1024
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_max_iterations_serde_default() {
        // Verify the serde default kicks in when the field is absent from config.
        let toml_str = r#"
            provider = ""
            base_url = ""
            model = ""
            api_key = ""
            max_tokens = 1024
        "#;
        let config: LlmModelConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(config.max_iterations, 10);
    }

    #[test]
    fn test_max_tokens_serde_default() {
        let toml = r#"
            provider = "openai"
            base_url = "https://api.openai.com/v1"
            model = "gpt-4o"
            api_key = "sk-test"
        "#;
        let config: LlmModelConfig =
            toml::from_str(toml).expect("should deserialize without max_tokens");
        assert_eq!(config.max_tokens, 1024);
    }
}
