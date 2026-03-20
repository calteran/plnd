import { Component, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { NavbarAvatarComponent } from '../../shared/components/navbar-avatar/navbar-avatar';

@Component({
  selector: 'app-main-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NavbarAvatarComponent],
  templateUrl: './main-layout.html',
  styleUrl: './main-layout.scss'
})
export class MainLayoutComponent {
  protected readonly sidebarExpanded = signal(false);

  expandSidebar(): void  { this.sidebarExpanded.set(true); }
  collapseSidebar(): void { this.sidebarExpanded.set(false); }
}
