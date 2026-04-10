/// Default value for `max_iterations` when absent from config.
fn default_max_iterations() -> u32 {
    10
}

/// Default value for `max_schema_retries` when absent from config.
fn default_max_schema_retries() -> u32 {
    1
}

/// Configuration for a single LLM endpoint (provider, model, credentials).
#[derive(Debug, serde::Deserialize, Clone)]
pub struct LlmModelConfig {
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub api_key: String,
    #[serde(default = "default_max_tokens")]
    pub max_tokens: u32,
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
    /// Maximum number of times the agent will retry after a schema validation
    /// failure before returning a 422. Each retry adds a full LLM round-trip;
    /// keep this low. Capped at 3 regardless of what is set here.
    #[serde(default = "default_max_schema_retries")]
    pub max_schema_retries: u32,
    #[serde(default)]
    pub api_version: Option<String>,
}

impl Default for LlmModelConfig {
    fn default() -> Self {
        Self {
            provider: String::new(),
            base_url: String::new(),
            model: String::new(),
            api_key: String::new(),
            max_tokens: default_max_tokens(),
            max_iterations: default_max_iterations(),
            max_schema_retries: default_max_schema_retries(),
            api_version: None,
        }
    }
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
        let toml_str = r#"
            provider = "openai"
            base_url = "https://api.openai.com/v1"
            model = "gpt-4o"
            api_key = "sk-test"
        "#;
        let config: LlmModelConfig =
            toml::from_str(toml_str).expect("should deserialize without max_tokens");
        assert_eq!(config.max_tokens, 1024);
    }

    #[test]
    fn test_max_tokens_rust_default() {
        let config = LlmModelConfig::default();
        assert_eq!(config.max_tokens, 1024);
        assert_eq!(config.max_iterations, 10);
        assert_eq!(config.max_schema_retries, 1);
    }

    #[test]
    fn test_max_schema_retries_serde_default() {
        let toml_str = r#"
            provider = "anthropic"
            base_url = "https://api.anthropic.com"
            model = "claude-sonnet-4-6"
            api_key = "sk-test"
        "#;
        let config: LlmModelConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(config.max_schema_retries, 1);
    }

    #[test]
    fn test_api_version_serde_default() {
        let toml_str = r#"
            provider = "anthropic"
            base_url = "https://api.anthropic.com"
            model = "claude-sonnet-4-6"
            api_key = "sk-test"
        "#;
        let config: LlmModelConfig = toml::from_str(toml_str).unwrap();
        assert_eq!(config.api_version, None);
    }
}
