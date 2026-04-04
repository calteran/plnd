use crate::config::LlmConfig;

/// Thin service wrapper that holds LLM configuration.
/// Full implementation added in Phase 3.2.
#[derive(Debug, Clone)]
pub struct AgentService {
    pub config: LlmConfig,
}

impl AgentService {
    pub fn new(config: &LlmConfig) -> Self {
        Self {
            config: config.clone(),
        }
    }
}
