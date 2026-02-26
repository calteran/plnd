# PLND - Planning Document

## Overview
PLND (pronounced "planned") is a planner/assistant designed for neurodivergent individuals who are picky eaters or struggle with nutrition and exercise. The goal is to provide a structured yet flexible tool to help users plan meals, track nutrition, and manage exercise routines in a way that accommodates their unique needs.

## Features Brainstorm

## Architecture

## Development Roadmap

## User Stories

### Authentication and Identification
- **As a user, I need to be identified correctly by the app** so that my personal data, preferences, and progress are accurately tracked and secured. This includes:
  - Secure login and authentication mechanisms (e.g., email/password, OAuth).
  - Persistent user sessions to avoid repeated logins.
  - Unique user profiles to store personal preferences, dietary restrictions, and exercise routines.
  - Role-based access control to differentiate between regular users, administrators, and other roles if needed.
  - Multi-factor authentication (MFA) for enhanced security, especially for sensitive data like health information.

### Planning and Adjustments
- **As a user, I want to be able to plan about a week in advance** so that I can organize my meals, exercise, and other activities efficiently. This includes:
  - A weekly view to plan meals, exercise routines, and other tasks.
  - The ability to set recurring plans (e.g., weekly meal plans or exercise routines).
  - Notifications or reminders for upcoming plans.

- **As a user, I want to be able to adjust plans day-by-day** so that I can adapt to changes in my schedule or preferences. This includes:
  - Easy editing of daily plans (e.g., swapping meals, rescheduling exercise).
  - Drag-and-drop functionality for rearranging tasks or meals.
  - The ability to override recurring plans for specific days without affecting the entire schedule.

### Calendar Integration
- **As a user, I want the app to be aware of my existing calendar** so that I don't have to reinvent the wheel. This includes:
  - Integration with popular calendar services (e.g., Google Calendar, Apple Calendar, Outlook).
  - Syncing with the device's native calendar app.
  - Displaying calendar events within the app to avoid scheduling conflicts.
  - The ability to link meal or exercise plans to existing calendar events.

### Personalization and Learning
- **As a user, I want the app to continuously learn my unique food preferences** so that meal suggestions improve over time. This includes:
  - Tracking my food preferences, likes, and dislikes.
  - Analyzing my eating habits and patterns (e.g., preferred meal times, portion sizes).
  - Adapting meal suggestions based on my feedback and behavior.
  - Incorporating dietary restrictions and allergies into meal recommendations.
  - Using machine learning or AI to refine suggestions and predict my preferences.

### Routine and Variety
- **As a user, I want meal planning to incorporate both my desired routines and a wider variety of meals** so that I can balance consistency with exploration. This includes:
  - Supporting recurring meals (e.g., same breakfast every day).
  - Encouraging variety in other meals (e.g., lunch or dinner) to ensure a balanced diet.
  - Allowing me to set preferences for how often I want to try new meals.
  - Providing suggestions for similar meals to gently expand my food choices.
  - Balancing routine and variety based on my preferences and goals.

### Food Preference Rating System
- **As a user, I want a rating system for my food preferences** so that the app can distinguish between meals or ingredients I love, tolerate, or avoid. This includes:
  - A rating scale (e.g., 1-5 stars) to indicate my preference for meals or ingredients.
  - Categories such as "Love," "Tolerate," and "Avoid" for quick classification.
  - The ability to mark specific ingredients as allergens or hard limits.
  - Using my ratings to prioritize meal suggestions (e.g., favoring meals with "Love" ingredients).
  - Avoiding meals or ingredients marked as "Avoid" unless explicitly overridden.

### Allergies and Safety
- **As a user, I want the app to distinguish between food preferences and allergies or safety-related issues** so that verboten ingredients are never recommended. This includes:
  - A separate category for allergens or unsafe ingredients (e.g., "Allergy" or "Forbidden").
  - Strict enforcement to exclude meals or ingredients marked as allergens or unsafe.
  - Clear visual indicators (e.g., warnings or highlights) for allergens in meal suggestions.
  - The ability to input and manage a list of allergens or forbidden ingredients separately from preferences.
  - Ensuring that safety-related restrictions override preference-based suggestions.

### Nutrition Guidelines
- **As a user, I want the app to be aware of one or more sets of nutrition guidelines** so that meal planning can align with my chosen standards. This includes:
  - Support for multiple nutrition guideline sets (e.g., USDA, European Union, or custom guidelines).
  - The ability to select and switch between different guideline sets.
  - Configurable tolerance levels for adherence to guidelines (e.g., strict, moderate, flexible).
  - Visual feedback on how well meal plans align with the chosen guidelines.
  - Recommendations to adjust meals to better meet the guidelines if needed.

### Ingredient Utilization
- **As a user, I want the app to adjust the meal plan based on ingredients I want to use up** so that I can reduce food waste. This includes:
  - The ability to input a list of ingredients I have on hand.
  - Suggestions for meals that use these ingredients.
  - Adjusting the meal plan to prioritize using up these ingredients.
  - Notifications or reminders to use ingredients before they expire.
  - The ability to mark ingredients as "use soon" or "priority."

### Location and Seasonality
- **As a user, I want the app to be location-aware and adjust meal recommendations based on local seasonality** so that I can eat seasonally and support local agriculture. This includes:
  - Detecting my location to determine local seasonal produce.
  - Adjusting meal suggestions to prioritize seasonal ingredients.
  - Providing information about what produce is in season in my area.
  - Allowing me to override or adjust seasonality settings if desired.
  - Integrating with local farmers' markets or grocery store availability data if possible.

### Exercise Planning
- **As a user, I want the app to help me develop an exercise plan to meet my fitness goals** so that I can stay active and healthy. This includes:
  - Setting fitness goals (e.g., weight loss, muscle gain, endurance).
  - Creating a personalized exercise plan based on my goals and preferences.
  - Integrating exercise into my daily plans, considering my preferred times of day.
  - Adjusting the exercise plan based on my progress and feedback.
  - Providing reminders and motivation for sticking to the plan.

- **As a user, I want exercise to be built into my daily plans** so that it becomes a seamless part of my routine. This includes:
  - Scheduling exercise sessions alongside meals and other activities.
  - Adjusting exercise intensity or duration based on my daily schedule.
  - Syncing exercise plans with my calendar to avoid conflicts.
  - Tracking my exercise progress and adjusting plans as needed.

### Medication Awareness
- **As a user, I want the app to be aware of medications I take that might affect eating, concentration, and exercise** so that it can adjust plans accordingly. This includes:
  - Inputting medication schedules and their effects (e.g., appetite suppression, cardiovascular impact).
  - Adjusting meal timing or portion sizes based on medication effects.
  - Avoiding scheduling intense exercise during periods when medication might make it uncomfortable or unsafe.
  - Providing reminders to take medications and tracking adherence.
  - Integrating medication schedules with meal and exercise plans to minimize conflicts.

### Sleep and Wake Times
- **As a user, I want the app to recommend wake/sleep times and remind me to set my alarm** so that I can maintain a healthy sleep schedule. This includes:
  - Suggesting optimal sleep and wake times based on my schedule and sleep needs.
  - Providing reminders to set my alarm for the recommended wake time.
  - Adjusting sleep recommendations based on my activity level and exercise plan.
  - Integrating sleep schedules with my meal and exercise plans to ensure consistency.

### Work Schedule Tracking
- **As a user, I want the app to track my work schedules** so that it can integrate with my meal and exercise plans. This includes:
  - Inputting long-term work patterns (e.g., "I work from 8-4 at the office M-F").
  - Adding short-term tasks or deadlines (e.g., "finish the quarterly report today").
  - Adjusting meal and exercise plans based on my work schedule.
  - Providing reminders for work-related tasks and deadlines.
  - Syncing work schedules with my calendar to avoid conflicts.

### Context-Aware Task Sequencing
- **As a user, I want the app to provide task sequencing that is aware of greater context** so that tasks are scheduled appropriately. This includes:
  - Scheduling work tasks during work hours and home tasks during personal time.
  - Adjusting task sequencing based on my location (e.g., work vs. home).
  - Prioritizing tasks based on their context (e.g., work tasks during work hours, errands during commute times).
  - Providing reminders for tasks at the appropriate time and location.
  - Allowing manual overrides for task sequencing when needed.

### Weather Awareness
- **As a user, I want the app to report and monitor local weather** so that I can plan outdoor activities accordingly. This includes:
  - Displaying current weather conditions and forecasts.
  - Recommending outdoor activities (e.g., exercise, errands) when the weather is favorable.
  - Adjusting activity suggestions based on weather conditions (e.g., indoor exercise on rainy days).
  - Providing weather-based reminders (e.g., "Take an umbrella today").
  - Allowing manual overrides for weather-based recommendations.

### Daily Briefing
- **As a user, I want to receive a daily briefing every morning** so that I can start my day informed and organized. This includes:
  - A summary of my task schedule for the day.
  - A summary of my meal plan for the day.
  - The weather forecast for the day.
  - Any important reminders or notifications (e.g., medications, deadlines).
  - The ability to customize what information is included in the briefing.

### Easy Adjustments
- **As a user, I want to easily adjust both tasks and meals scheduled throughout the day** so that I can adapt to changes in my plans. This includes:
  - A simple interface for rescheduling or modifying tasks and meals.
  - Drag-and-drop functionality for rearranging tasks and meals.
  - The ability to quickly swap meals or tasks with alternatives.
  - Real-time updates to my schedule when adjustments are made.
  - Notifications or confirmations for significant changes to my plans.

### Task and Meal Reminders
- **As a user, I want to receive reminders when it's time to switch tasks or start meal prep** so that I can stay on track with my plans. This includes:
  - Customizable reminders for task transitions.
  - Reminders to start meal prep based on the scheduled meal time.
  - Adjustable lead times for reminders (e.g., 10 minutes before a task or meal).
  - The ability to snooze or dismiss reminders as needed.
  - Integration with my device's notification system for timely alerts.

### Progress Tracking and Adjustments
- **As a user, I want the app to keep track of tasks accomplished and food consumed** so that it can adjust future schedules to keep me on track. This includes:
  - Logging completed tasks and meals.
  - Tracking progress toward daily and weekly goals.
  - Adjusting future meal and exercise plans based on my progress.
  - Providing feedback on my adherence to plans and suggestions for improvement.
  - Allowing manual input or corrections to logged data.

## Technical Considerations

## Next Steps

## Open Questions

## Resources

## Conclusion