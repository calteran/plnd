export interface WeatherSummary {
  temperature_c: number;
  condition: string;
  high_c: number;
  low_c: number;
  precipitation_mm: number;
}

export interface NewsHeadline {
  title: string;
  url?: string;
}

export interface YesterdaySnapshot {
  tasks_done: number;
  tasks_total: number;
  meals_logged: number;
  meals_planned: number;
}
