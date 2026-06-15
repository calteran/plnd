pub mod agent;
pub mod brand_normalizer;
pub mod config;
pub mod context;
pub mod provider;
pub(crate) mod tools;

pub use agent::{AgentError, AgentOutput, AgentService, xml_escape};
#[cfg(debug_assertions)]
pub use brand_normalizer::FixtureBrandNormalizer;
pub use brand_normalizer::{BRAND_CONFIDENCE_THRESHOLD, BrandNormalizer, Normalization};
pub use config::LlmConfig;
pub use context::{AgentContext, UseCase};
pub use tools::{Tool, ToolContext, ToolError};
