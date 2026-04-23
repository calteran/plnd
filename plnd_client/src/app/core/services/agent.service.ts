import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ConfigService } from './config.service';
import { TaskEntryRequest, TaskEntryResponse } from '../models/agent';
import { PlaceTasksRequest, PlaceTasksEntry } from '../models/week-plan';

@Injectable({ providedIn: 'root' })
export class AgentService {
  private readonly http   = inject(HttpClient);
  private readonly config = inject(ConfigService);

  createTask(request: TaskEntryRequest): Observable<TaskEntryResponse> {
    const base = this.config.getConfig().api.baseUrl;
    return this.http.post<TaskEntryResponse>(`${base}/agent/task`, request);
  }

  placeTasks(request: PlaceTasksRequest): Observable<PlaceTasksEntry[]> {
    const base = this.config.getConfig().api.baseUrl;
    return this.http.post<PlaceTasksEntry[]>(`${base}/agent/place-tasks`, request);
  }
}
