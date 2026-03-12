pub mod dtos;
pub mod error;
pub mod exercise;
pub mod nutrition;
pub mod open_food_facts;
pub mod recipe;
pub mod themealdb;
pub mod usda_fdc;

pub use error::ExternalClientError;
pub use exercise::ExerciseProvider;
pub use nutrition::NutritionProvider;
pub use open_food_facts::OpenFoodFactsClient;
pub use recipe::RecipeProvider;
pub use themealdb::TheMealDbClient;
pub use usda_fdc::UsdaFdcClient;
