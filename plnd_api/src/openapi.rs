use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};

use crate::api_response::{
    CarryoverApiResponse, CatalogDishIngredientResponse, CatalogIngredientResponse,
    CatalogMealDishResponse, CommittedEntryRef, DayTypeResponse, DietaryRestrictionResponse,
    DishDetailApiResponse, MealAnchorInstanceResponse, MealDetailApiResponse,
    MealPatternEntryResponse, MealSuggestionResponse, PlanStatusApiResponse,
    PlannedMealEntryResponse, PostSchedulePlanApiResponse, RoutineResponse, ScheduleEntryResponse,
    SchedulePeriodApiResponse, TaskResponse, UserDishPrefDetailResponse,
    UserIngredientPrefResponse, UserMealPrefDetailResponse, UserPreferencesResponse, UserResponse,
};
use crate::models::{
    CarryoverDecision, ConversationTurn, CreateMealPatternEntryRequest,
    CreateScheduleAnchorRequest, FailedSlot, MealAdhocResolveRequest, MealAdhocResolveResponse,
    MealEntry, MealEntryRequest, MealPlanRequest, MealPlanResponse, MealPlanState, MealRef,
    MealSuggestRequest, Nutrition, NutritionSummary, PatchEntryRequest,
    PatchEntryStatusRequest, PlaceTasksEntry, PlaceTasksRequest, PlanEntryRequest,
    PostSchedulePlanRequest, ReadyStatus, SetAnchorStatusRequest, SlotRef, TaskEntryRequest,
    TaskEntryResponse, UnplannableReason, UpdateMealPatternEntryRequest,
    UpdateScheduleAnchorRequest,
};
use crate::routes::{
    briefing::{NewsHeadlineResponse, NewsResponse, WeatherResponse, YesterdayResponse},
    catalog_ingest::{
        ContributeIngredientBody, ContributeIngredientResponse, IngestIngredientBody,
        IngestIngredientResponse, PromoteIngredientBody,
    },
    day_types::{CreateDayTypeRequest, UpdateDayTypeRequest},
    dietary_restrictions::{CreateRestrictionRequest, UpdateRestrictionRequest},
    routine::CreateRoutineRequest,
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
        // Meal Pattern
        crate::routes::meal_pattern::list_meal_pattern,
        crate::routes::meal_pattern::create_meal_pattern_entry,
        crate::routes::meal_pattern::update_meal_pattern_entry,
        crate::routes::meal_pattern::delete_meal_pattern_entry,
        // Catalog
        crate::routes::catalog_ingest::contribute_ingredient,
        crate::routes::catalog_ingest::ingest_ingredient,
        crate::routes::catalog_ingest::promote_ingredient,
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
        crate::routes::schedule::get_plan_carryover,
        crate::routes::schedule::get_plan_status,
        crate::routes::schedule::post_plan,
        crate::routes::schedule::patch_entry_status,
        crate::routes::schedule::patch_entry,
        // Schedule Anchors (per-date meal anchor instances, #828)
        crate::routes::schedule_anchors::list_for_date,
        crate::routes::schedule_anchors::create,
        crate::routes::schedule_anchors::update,
        crate::routes::schedule_anchors::delete,
        crate::routes::schedule_anchors::set_status,
        // Routines
        crate::routes::routine::list_routines,
        crate::routes::routine::create_routine,
        crate::routes::routine::delete_routine,
        // Day Types
        crate::routes::day_types::list_day_types,
        crate::routes::day_types::create_day_type,
        crate::routes::day_types::update_day_type,
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
        MealPatternEntryResponse,
        ReadyStatus,
        UpdateProfileRequest,
        CreateRestrictionRequest,
        UpdateRestrictionRequest,
        CreateMealPatternEntryRequest,
        UpdateMealPatternEntryRequest,
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
        PromoteIngredientBody,
        ContributeIngredientBody,
        ContributeIngredientResponse,
        // Tasks
        TaskResponse,
        // Schedule
        ScheduleEntryResponse,
        CarryoverApiResponse,
        SchedulePeriodApiResponse,
        PlanStatusApiResponse,
        CommittedEntryRef,
        PostSchedulePlanApiResponse,
        PostSchedulePlanRequest,
        PlanEntryRequest,
        MealEntryRequest,
        PlannedMealEntryResponse,
        MealAnchorInstanceResponse,
        CreateScheduleAnchorRequest,
        UpdateScheduleAnchorRequest,
        SetAnchorStatusRequest,
        CarryoverDecision,
        PatchEntryStatusRequest,
        PatchEntryRequest,
        RoutineResponse,
        CreateRoutineRequest,
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
        MealRef,
        Nutrition,
        MealEntry,
        SlotRef,
        FailedSlot,
        MealPlanState,
        MealPlanRequest,
        NutritionSummary,
        MealPlanResponse,
        UnplannableReason,
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
        (name = "Meal Pattern", description = "User meal pattern entries — named meal slots with preferred times"),
        (name = "Briefing", description = "Morning briefing — weather, news, and yesterday recap"),
        (name = "Catalog", description = "Catalog ingredient, dish, and meal lookups and ingest"),
        (name = "My Ingredient Prefs", description = "User ingredient preference management (blocked/notes)"),
        (name = "My Dishes", description = "Personal dish library with fork-and-edit support"),
        (name = "My Meals", description = "Personal meal library with fork-and-edit support"),
        (name = "Search", description = "Full-text search across catalog, personal library, and external providers"),
        (name = "Tasks", description = "Task management (weekly planning task creation)"),
        (name = "Meal Suggestions", description = "Meal suggestions for a given date and slot"),
        (name = "Schedule", description = "Schedule period queries and weekly plan commits"),
        (name = "Routines", description = "Recurring routine management"),
        (name = "Day Types", description = "User day type management — named daily rhythm patterns with wake/sleep times and date mapping"),
        (name = "Agent", description = "LLM-backed task parsing and meal planning (stubs — Phase 3.2/3.3)"),
    )
)]
pub struct ApiDoc;
