import { Component, inject } from '@angular/core';
import { BriefingService } from '../../../../core/services/briefing.service';

@Component({
  selector: 'app-briefing-header',
  standalone: true,
  template: `
    <div class="briefing-header">

      <!-- Weather card -->
      <div class="briefing-card">
        @if (briefing.weather(); as w) {
          <div class="weather-content">
            <span class="weather-temp">{{ Math.round(w.temperature_c) }}°</span>
            <span class="weather-condition">{{ w.condition }}</span>
            <span class="weather-range">
              {{ Math.round(w.high_c) }}° / {{ Math.round(w.low_c) }}°
            </span>
          </div>
        } @else if (briefing.weatherError()) {
          <span class="unavailable-text">{{ briefing.weatherError() }}</span>
        } @else {
          <div class="skeleton skeleton--weather" aria-label="Loading weather"></div>
        }
      </div>

      <!-- News card -->
      <div class="briefing-card">
        @if (briefing.news(); as headlines) {
          <div class="news-content">
            <span class="news-label">Headlines</span>
            <ul class="headlines-list">
              @for (h of headlines; track h.title) {
                <li>
                  @if (h.url) {
                    <a [href]="h.url" target="_blank" rel="noopener">{{ h.title }}</a>
                  } @else {
                    {{ h.title }}
                  }
                </li>
              }
            </ul>
          </div>
        } @else if (briefing.newsError()) {
          <span class="unavailable-text">{{ briefing.newsError() }}</span>
        } @else {
          <div class="skeleton skeleton--news" aria-label="Loading headlines"></div>
        }
      </div>

    </div>
  `,
  styleUrl: './briefing-header.scss',
})
export class BriefingHeaderComponent {
  protected readonly briefing = inject(BriefingService);
  protected readonly Math = Math;
}
