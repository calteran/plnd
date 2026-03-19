import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ConfigService } from './config.service';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(ConfigService);

  private get apiBase(): string {
    return this.config.getConfig().api.baseUrl;
  }

  getIngredient(id: string): Observable<unknown> {
    return this.http.get(`${this.apiBase}/catalog/ingredients/${id}`);
  }

  getDish(id: string): Observable<unknown> {
    return this.http.get(`${this.apiBase}/catalog/dishes/${id}`);
  }

  getMeal(id: string): Observable<unknown> {
    return this.http.get(`${this.apiBase}/catalog/meals/${id}`);
  }

  ingestIngredient(body: unknown): Observable<{ catalog_ingredient_id: string }> {
    return this.http.post<{ catalog_ingredient_id: string }>(
      `${this.apiBase}/catalog/ingredients/ingest`,
      body
    );
  }
}
