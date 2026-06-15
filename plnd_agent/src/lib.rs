pub mod agent;
pub mod brand_normalizer;
pub mod config;
pub mod context;
pub mod provider;
pub(crate) mod tools;

pub use agent::{AgentError, AgentOutput, AgentService, build_fast_provider, xml_escape};
#[cfg(debug_assertions)]
pub use brand_normalizer::FixtureBrandNormalizer;
pub use brand_normalizer::{
    BRAND_CONFIDENCE_THRESHOLD, BrandNormalizer, LlmBrandNormalizer, Normalization,
};
pub use config::LlmConfig;
pub use context::{AgentContext, UseCase};
pub use tools::{Tool, ToolContext, ToolError};
