use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};

use crate::db::models::{DietaryRestriction, ReadyStatus, User, UserPreferences};
use crate::routes::{
    briefing::{NewsHeadlineResponse, NewsResponse, WeatherResponse, YesterdayResponse},
    dietary_restrictions::{CreateRestrictionRequest, UpdateRestrictionRequest},
    users::UpdateProfileRequest,
};

struct BearerSecurityAddon;

impl Modify for BearerSecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer_auth",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .build(),
            ),
        );
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "PLND API",
        version = "0.1.0",
        description = "Neurodivergent-focused planner API for nutrition, exercise, and daily planning"
    ),
    paths(
        crate::routes::system::health_check,
        crate::routes::system::readiness_check,
        crate::routes::auth::token_exchange,
        crate::routes::auth::logout,
        crate::routes::users::get_me,
        crate::routes::users::patch_me,
        crate::routes::users::delete_me,
        crate::routes::users::post_complete_onboarding,
        crate::routes::preferences::get_preferences,
        crate::routes::briefing::get_weather,
        crate::routes::briefing::get_news,
        crate::routes::briefing::get_yesterday,
        crate::routes::dietary_restrictions::list_restrictions,
        crate::routes::dietary_restrictions::create_restriction,
        crate::routes::dietary_restrictions::update_restriction,
        crate::routes::dietary_restrictions::delete_restriction,
    ),
    components(schemas(
        User,
        UserPreferences,
        DietaryRestriction,
        ReadyStatus,
        UpdateProfileRequest,
        CreateRestrictionRequest,
        UpdateRestrictionRequest,
        WeatherResponse,
        NewsHeadlineResponse,
        NewsResponse,
        YesterdayResponse,
    )),
    modifiers(&BearerSecurityAddon),
    tags(
        (name = "System", description = "Health and readiness endpoints"),
        (name = "Auth", description = "Token exchange and session management"),
        (name = "Users", description = "User profile management"),
        (name = "Preferences", description = "User preference settings"),
        (name = "Dietary Restrictions", description = "Dietary restriction management"),
        (name = "Briefing", description = "Morning briefing — weather, news, and yesterday recap"),
    )
)]
pub struct ApiDoc;
