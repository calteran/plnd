import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-not-found',
  standalone: true,
  template: `
    <div class="not-found">
      <h1>Page not found</h1>
      <p>The page you requested doesn't exist. If you followed a date link, the date may be invalid or out of range.</p>
      <button type="button" (click)="goToToday()">Go to today</button>
    </div>
  `,
  styles: [`
    .not-found {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 60vh;
      gap: 1rem;
      text-align: center;
      padding: 2rem;
    }

    h1 {
      font-size: 2rem;
      color: var(--color-text-primary);
    }

    p {
      color: var(--color-text-muted);
      max-width: 40ch;
    }

    button {
      padding: 0.5rem 1.5rem;
      background: var(--color-accent);
      color: #fff;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1rem;
    }

    button:hover {
      opacity: 0.9;
    }
  `]
})
export class NotFoundComponent {
  private readonly router = inject(Router);

  goToToday(): void {
    this.router.navigate(['/today']);
  }
}
