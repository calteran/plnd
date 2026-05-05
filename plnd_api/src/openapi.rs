use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};

use crate::api_response::{
    CatalogDishIngredientResponse, CatalogIngredientResponse, CatalogMealDishResponse,
    DayTypeResponse, DietaryRestrictionResponse, DishDetailApiResponse, MealDetailApiResponse,
    MealHabitResponse, MealSuggestionResponse, PlanStatusApiResponse, PostSchedulePlanApiResponse,
    ScheduleEntryResponse, SchedulePeriodApiResponse, ScheduleTemplateResponse, TaskResponse,
    UserDishPrefDetailResponse, UserIngredientPrefResponse, UserMealPrefDetailResponse,
    UserPreferencesResponse, UserResponse,
};
use crate::models::{
    CarryoverDecision, ConversationTurn, CreateMealHabitRequest, MealAdhocResolveRequest,
    MealAdhocResolveResponse, MealEntry, MealPlanRequest, MealPlanResponse, MealPlanState, MealRef,
    MealSuggestRequest, Nutrition, NutritionSummary, Occasion, PatchEntryStatusRequest,
    PlaceTasksEntry, PlaceTasksRequest, PlanEntryRequest, PostSchedulePlanRequest, ReadyStatus,
    SlotRef, TaskEntryRequest, TaskEntryResponse,
};
use crate::routes::{
    briefing::{NewsHeadlineResponse, NewsResponse, WeatherResponse, YesterdayResponse},
    catalog_ingest::{IngestIngredientBody, IngestIngredientResponse},
    day_types::{CreateDayTypeRequest, UpdateDayTypeRequest},
    dietary_restrictions::{CreateRestrictionRequest, UpdateRestrictionRequest},
    schedule_template::CreateScheduleTemplateRequest,
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
        // Meal Habits
        crate::routes::meal_habits::list_meal_habits,
        crate::routes::meal_habits::create_meal_habit,
        crate::routes::meal_habits::delete_meal_habit,
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
        // Meal Suggestions
        crate::routes::meal_suggestions::get_suggestions,
        // Schedule
        crate::routes::schedule::get_period,
        crate::routes::schedule::get_plan_status,
        crate::routes::schedule::post_plan,
        crate::routes::schedule::patch_entry_status,
        // Schedule Templates
        crate::routes::schedule_template::list_templates,
        crate::routes::schedule_template::create_template,
        crate::routes::schedule_template::delete_template,
        // Day Types
        crate::routes::day_types::list_day_types,
        crate::routes::day_types::create_day_type,
        crate::routes::day_types::update_day_type,
        crate::routes::day_types::set_default_day_type,
        crate::routes::day_types::delete_day_type,
        // Agent
        crate::routes::agent::post_task,
        crate::routes::agent::post_meal_plan,
        crate::routes::agent::post_meal_plan_rebalance,
        crate::routes::agent::post_meal_plan_suggest,
        crate::routes::agent::post_meal_plan_resolve,
        crate::routes::agent::post_place_tasks,
    ),
    components(schemas(
        // Existing
        UserResponse,
        UserPreferencesResponse,
        DietaryRestrictionResponse,
        MealHabitResponse,
        ReadyStatus,
        UpdateProfileRequest,
        CreateRestrictionRequest,
        UpdateRestrictionRequest,
        CreateMealHabitRequest,
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
        PlanEntryRequest,
        CarryoverDecision,
        PatchEntryStatusRequest,
        ScheduleTemplateResponse,
        CreateScheduleTemplateRequest,
        DayTypeResponse,
        CreateDayTypeRequest,
        UpdateDayTypeRequest,
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
        // Meal Suggestions
        MealSuggestionResponse,
        // Search responses
        IngredientSearchResponse,
        DishSearchResponse,
        ExerciseSearchResponse,
        // Agent
        ConversationTurn,
        TaskEntryRequest,
        TaskEntryResponse,
        // Meal Planning
        Occasion,
        MealRef,
        Nutrition,
        MealEntry,
        SlotRef,
        MealPlanState,
        MealPlanRequest,
        NutritionSummary,
        MealPlanResponse,
        MealSuggestRequest,
        MealAdhocResolveRequest,
        MealAdhocResolveResponse,
        // Task Placement
        PlaceTasksRequest,
        PlaceTasksEntry,
    )),
    modifiers(&BearerSecurityAddon),
    tags(
        (name = "System", description = "Health and readiness endpoints"),
        (name = "Auth", description = "Token exchange and session management"),
        (name = "Users", description = "User profile management"),
        (name = "Preferences", description = "User preference settings"),
        (name = "Dietary Restrictions", description = "Dietary restriction management"),
        (name = "Meal Habits", description = "Recurring meal preferences used during onboarding"),
        (name = "Briefing", description = "Morning briefing — weather, news, and yesterday recap"),
        (name = "Catalog", description = "Catalog ingredient, dish, and meal lookups and ingest"),
        (name = "My Ingredient Prefs", description = "User ingredient preference management (blocked/notes)"),
        (name = "My Dishes", description = "Personal dish library with fork-and-edit support"),
        (name = "My Meals", description = "Personal meal library with fork-and-edit support"),
        (name = "Search", description = "Full-text search across catalog, personal library, and external providers"),
        (name = "Tasks", description = "Task management (weekly planning task creation)"),
        (name = "Meal Suggestions", description = "Meal suggestions for a given date and slot"),
        (name = "Schedule", description = "Schedule period queries and weekly plan commits"),
        (name = "Schedule Templates", description = "Recurring routine template management"),
        (name = "Day Types", description = "User day type management — named daily rhythm patterns with wake/sleep times and date mapping"),
        (name = "Agent", description = "LLM-backed task parsing and meal planning (stubs — Phase 3.2/3.3)"),
    )
)]
pub struct ApiDoc;
