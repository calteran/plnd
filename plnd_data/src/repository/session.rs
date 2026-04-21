use async_trait::async_trait;
use uuid::Uuid;



#[async_trait]
pub trait SessionRepository: Send + Sync {
    async fn create(
        &self,
        user_id: Uuid,
        jti: &str,
        ip_address: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<String,crate::Error>;

    async fn validate(&self, jti: &str) -> Result<bool,crate::Error>;

    async fn revoke(&self, jti: &str) -> Result<(),crate::Error>;
}
