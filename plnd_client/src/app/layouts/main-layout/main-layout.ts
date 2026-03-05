import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavbarAvatarComponent } from '../../shared/components/navbar-avatar/navbar-avatar';

@Component({
  selector: 'app-main-layout',
  imports: [RouterOutlet, NavbarAvatarComponent],
  template: `
    <div class="main-layout">
      <nav class="main-nav">
        <span class="app-title">PLND</span>
        <app-navbar-avatar />
      </nav>
      <div class="main-content">
        <aside class="sidebar">
          <!-- Navigation links will go here in Phase 2 proper -->
        </aside>
        <main class="content-area">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: [`
    .main-layout { display: flex; flex-direction: column; min-height: 100vh; }
    .main-nav { padding: 0.75rem 1rem; border-bottom: 1px solid #e0e0e0; display: flex; justify-content: space-between; align-items: center; }
    .app-title { font-weight: 600; font-size: 1.25rem; }
    .main-content { display: flex; flex: 1; }
    .sidebar { width: 200px; border-right: 1px solid #e0e0e0; padding: 1rem; }
    .content-area { flex: 1; padding: 1rem; }
  `]
})
export class MainLayoutComponent {}
