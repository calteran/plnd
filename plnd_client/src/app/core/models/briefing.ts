export interface WeatherSummary {
  temp_c: number;
  condition: string;
  high_c: number;
  low_c: number;
  precipitation_flag: boolean;
}

export interface YesterdaySnapshot {
  tasks_done: number;
  tasks_total: number;
  meals_logged: number;
  meals_planned: number;
}
