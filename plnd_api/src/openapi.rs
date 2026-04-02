use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};

use crate::api_response::{
    CatalogDishIngredientResponse, CatalogIngredientResponse, CatalogMealDishResponse,
    DietaryRestrictionResponse, DishDetailApiResponse, MealDetailApiResponse,
    PlanStatusApiResponse, PostSchedulePlanApiResponse, ScheduleEntryResponse,
    SchedulePeriodApiResponse, TaskResponse, UserDishPrefDetailResponse,
    UserIngredientPrefResponse, UserMealPrefDetailResponse, UserPreferencesResponse, UserResponse,
};
use crate::models::{PostSchedulePlanRequest, ReadyStatus};
use crate::routes::{
    briefing::{NewsHeadlineResponse, NewsResponse, WeatherResponse, YesterdayResponse},
    catalog_ingest::{IngestIngredientBody, IngestIngredientResponse},
    dietary_restrictions::{CreateRestrictionRequest, UpdateRestrictionRequest},
    search::{DishSearchResponse, ExerciseSearchResponse, IngredientSearchResponse},
    user_dish_prefs::{AddIngredientBody, CreateDishBody, PatchDishBody},
    user_ingredient_prefs::UpsertIngredientPrefBody,
    user_meal_prefs::{AddDishBody, CreateMealBody, PatchMealBody},
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
        // System
        crate::routes::system::health_check,
        crate::routes::system::readiness_check,
        // Auth
        crate::routes::auth::token_exchange,
        crate::routes::auth::logout,
        // Users
        crate::routes::users::get_me,
        crate::routes::users::patch_me,
        crate::routes::users::delete_me,
        crate::routes::users::post_complete_onboarding,
        // Preferences
        crate::routes::preferences::patch_preferences,
        crate::routes::preferences::get_preferences,
        // Briefing
        crate::routes::briefing::get_weather,
        crate::routes::briefing::get_news,
        crate::routes::briefing::get_yesterday,
        // Dietary Restrictions
        crate::routes::dietary_restrictions::list_restrictions,
        crate::routes::dietary_restrictions::create_restriction,
        crate::routes::dietary_restrictions::update_restriction,
        crate::routes::dietary_restrictions::delete_restriction,
        // Catalog
        crate::routes::catalog_ingest::ingest_ingredient,
        crate::routes::catalog_details::get_ingredient,
        crate::routes::catalog_details::get_dish,
        crate::routes::catalog_details::get_meal,
        // My Ingredient Prefs
        crate::routes::user_ingredient_prefs::list,
        crate::routes::user_ingredient_prefs::upsert,
        crate::routes::user_ingredient_prefs::delete,
        // My Dishes
        crate::routes::user_dish_prefs::list,
        crate::routes::user_dish_prefs::get_detail,
        crate::routes::user_dish_prefs::create,
        crate::routes::user_dish_prefs::patch,
        crate::routes::user_dish_prefs::delete,
        crate::routes::user_dish_prefs::add_ingredient,
        crate::routes::user_dish_prefs::remove_ingredient,
        // My Meals
        crate::routes::user_meal_prefs::list,
        crate::routes::user_meal_prefs::get_detail,
        crate::routes::user_meal_prefs::create,
        crate::routes::user_meal_prefs::patch,
        crate::routes::user_meal_prefs::delete,
        crate::routes::user_meal_prefs::add_dish,
        crate::routes::user_meal_prefs::remove_dish,
        // Search
        crate::routes::search::search_ingredients_handler,
        crate::routes::search::search_dishes_handler,
        crate::routes::search::search_exercises_handler,
        // Tasks
        crate::routes::tasks::post_weekly_plan_task,
        // Schedule
        crate::routes::schedule::get_period,
        crate::routes::schedule::get_plan_status,
        crate::routes::schedule::post_plan,
    ),
    components(schemas(
        // Existing
        UserResponse,
        UserPreferencesResponse,
        DietaryRestrictionResponse,
        ReadyStatus,
        UpdateProfileRequest,
        CreateRestrictionRequest,
        UpdateRestrictionRequest,
        WeatherResponse,
        NewsHeadlineResponse,
        NewsResponse,
        YesterdayResponse,
        // Catalog
        CatalogIngredientResponse,
        CatalogDishIngredientResponse,
        CatalogMealDishResponse,
        DishDetailApiResponse,
        MealDetailApiResponse,
        IngestIngredientBody,
        IngestIngredientResponse,
        // Tasks
        TaskResponse,
        // Schedule
        ScheduleEntryResponse,
        SchedulePeriodApiResponse,
        PlanStatusApiResponse,
        PostSchedulePlanApiResponse,
        PostSchedulePlanRequest,
        // User library preferences
        UserDishPrefDetailResponse,
        UserIngredientPrefResponse,
        UserMealPrefDetailResponse,
        // Request bodies
        CreateDishBody,
        PatchDishBody,
        AddIngredientBody,
        CreateMealBody,
        PatchMealBody,
        AddDishBody,
        UpsertIngredientPrefBody,
        // Search responses
        IngredientSearchResponse,
        DishSearchResponse,
        ExerciseSearchResponse,
    )),
    modifiers(&BearerSecurityAddon),
    tags(
        (name = "System", description = "Health and readiness endpoints"),
        (name = "Auth", description = "Token exchange and session management"),
        (name = "Users", description = "User profile management"),
        (name = "Preferences", description = "User preference settings"),
        (name = "Dietary Restrictions", description = "Dietary restriction management"),
        (name = "Briefing", description = "Morning briefing — weather, news, and yesterday recap"),
        (name = "Catalog", description = "Catalog ingredient, dish, and meal lookups and ingest"),
        (name = "My Ingredient Prefs", description = "User ingredient preference management (blocked/notes)"),
        (name = "My Dishes", description = "Personal dish library with fork-and-edit support"),
        (name = "My Meals", description = "Personal meal library with fork-and-edit support"),
        (name = "Search", description = "Full-text search across catalog, personal library, and external providers"),
        (name = "Tasks", description = "Task management (weekly planning task creation)"),
        (name = "Schedule", description = "Schedule period queries and weekly plan commits"),
    )
)]
pub struct ApiDoc;
