import { ChangeDetectionStrategy, Component, inject, OnInit, PLATFORM_ID, effect } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { isPlatformBrowser } from '@angular/common';
import { DataService } from './services/data.service';
import { AuthService } from './services/auth.service';
import { ShopSettings } from './models';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet]
})
export class AppComponent implements OnInit {
  private dataService = inject(DataService);
  private authService = inject(AuthService);
  // FIX: Unifying dependency injection to use the `inject` function and explicitly typing `title` to resolve a type inference issue.
  private title: Title = inject(Title);
  private platformId = inject(PLATFORM_ID);
  
  loadingStatus = this.dataService.loadingStatus;
  loadingError = this.dataService.loadingError;

  constructor() {
    effect(() => {
      if (this.dataService.loadingStatus() === 'loaded') {
        const settings = this.dataService.settings();
        this.updatePwaMetadata(settings);
      }
    });
  }

  ngOnInit() {
    // Primeiro, inicializa o estado de autenticação a partir do armazenamento local.
    this.authService.init();
    // Em seguida, carrega todos os dados da aplicação.
    this.dataService.load();
  }

  private updatePwaMetadata(settings: ShopSettings): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.title.setTitle(settings.name);

    const manifest = {
      name: settings.name,
      short_name: settings.name.split(' ')[0],
      start_url: ".",
      display: "standalone",
      background_color: settings.layout.background_color,
      theme_color: settings.layout.primary_color,
      icons: [
        {
          src: settings.logo_url || 'favicon.ico',
          sizes: "192x192",
          type: "image/png",
          purpose: "any maskable"
        },
        {
          src: settings.logo_url || 'favicon.ico',
          sizes: "512x512",
          type: "image/png",
          purpose: "any maskable"
        }
      ]
    };

    const manifestBlob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const manifestUrl = URL.createObjectURL(manifestBlob);
    
    const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (manifestLink) {
      manifestLink.href = manifestUrl;
    }

    const appleIconLink = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    if (appleIconLink) {
      appleIconLink.href = settings.logo_url || 'favicon.ico';
    }
    
    const themeColorMeta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.content = settings.layout.primary_color;
    }
  }
}
