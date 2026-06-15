import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ConfigService } from './config.service';
import {
  TimezoneAnchorDto, ResolveResponse, DeviceAffirmResponse, CreateAnchorRequest,
} from '../models/timezone';

@Injectable({ providedIn: 'root' })
export class TimezoneService {
  private readonly http = inject(HttpClient);
  private readonly apiBase = inject(ConfigService).getConfig().api.baseUrl;

  /** The device's current IANA zone, e.g. "America/Denver". */
  deviceZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  reportDeviceZone(zone: string): Observable<DeviceAffirmResponse> {
    return this.http.post<DeviceAffirmResponse>(`${this.apiBase}/timezone/device`, { zone });
  }

  resolve(at: string, time?: string): Observable<ResolveResponse> {
    const q = time ? `?at=${at}&time=${time}` : `?at=${at}`;
    return this.http.get<ResolveResponse>(`${this.apiBase}/timezone/resolve${q}`);
  }

  listAnchors(through: string): Observable<TimezoneAnchorDto[]> {
    return this.http.get<TimezoneAnchorDto[]>(`${this.apiBase}/timezone/anchors?through=${through}`);
  }

  createAnchor(body: CreateAnchorRequest): Observable<TimezoneAnchorDto> {
    return this.http.post<TimezoneAnchorDto>(`${this.apiBase}/timezone/anchors`, body);
  }

  deleteAnchor(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiBase}/timezone/anchors/${id}`);
  }

  deleteGroup(group: string): Observable<{ deleted: number }> {
    return this.http.delete<{ deleted: number }>(`${this.apiBase}/timezone/anchors/group/${group}`);
  }

  dismissStandoff(): Observable<void> {
    return this.http.post<void>(`${this.apiBase}/timezone/standoff/dismiss`, {});
  }
}
