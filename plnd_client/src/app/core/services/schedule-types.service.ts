import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ConfigService } from './config.service';
import { DayTypeResponse, CreateDayTypeRequest } from '../models/schedule-type';

/**
 * Converts a days bitmask to an array of day numbers.
 * Bit 0=Sun (0), bit 1=Mon (1), …, bit 6=Sat (6).
 * e.g. bitmaskToDays(62) → [1,2,3,4,5]  (Mon–Fri)
 * e.g. bitmaskToDays(65) → [0,6]         (Sun+Sat)
 */
export function bitmaskToDays(mask: number): number[] {
  const days: number[] = [];
  for (let i = 0; i < 7; i++) {
    if (mask & (1 << i)) days.push(i);
  }
  return days;
}

/**
 * Converts an array of day numbers to a bitmask.
 * e.g. daysToBitmask([1,2,3,4,5]) → 62
 * e.g. daysToBitmask([0,6])       → 65
 */
export function daysToBitmask(days: number[]): number {
  return days.reduce((mask, day) => mask | (1 << day), 0);
}

@Injectable({ providedIn: 'root' })
export class DayTypesService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  list(): Observable<DayTypeResponse[]> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.get<DayTypeResponse[]>(`${apiBase}/day-types`);
  }

  create(req: CreateDayTypeRequest): Observable<DayTypeResponse> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.post<DayTypeResponse>(`${apiBase}/day-types`, req);
  }

  update(id: string, req: CreateDayTypeRequest): Observable<DayTypeResponse> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.put<DayTypeResponse>(`${apiBase}/day-types/${id}`, req);
  }

  setDefault(id: string): Observable<DayTypeResponse> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.patch<DayTypeResponse>(`${apiBase}/day-types/${id}/default`, {});
  }

  delete(id: string): Observable<void> {
    const apiBase = this.config.getConfig().api.baseUrl;
    return this.http.delete<void>(`${apiBase}/day-types/${id}`);
  }
}

// Legacy alias — removed in Task 8 once all consumers are updated
/** @deprecated Use DayTypesService */
export { DayTypesService as ScheduleTypesService };
