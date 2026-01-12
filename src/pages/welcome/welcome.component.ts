import { ChangeDetectionStrategy, Component, inject, signal, OnInit, OnDestroy, computed } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-welcome',
  templateUrl: './welcome.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink]
})
export class WelcomeComponent implements OnInit, OnDestroy {
  // FIX: Explicitly type injected services to resolve type inference issues.
  dataService: DataService = inject(DataService);
  // FIX: Explicitly type injected services to resolve type inference issues.
  authService: AuthService = inject(AuthService);
  // FIX: Explicitly type injected services to resolve type inference issues.
  router: Router = inject(Router);
  settings = this.dataService.settings;
  user = this.authService.currentUser;

  isLoginModalOpen = signal(false);

  sliderImages = computed(() => {
    const images = this.settings().slider_images;
    if (!images || images.length === 0) {
      return ['https://picsum.photos/id/102/1280/720'];
    }
    return images;
  });

  currentIndex = signal(0);
  private intervalId?: number;

  ngOnInit() {
    this.startSlider();
  }

  ngOnDestroy() {
    this.stopSlider();
  }

  startSlider(): void {
    this.intervalId = window.setInterval(() => {
      const images = this.sliderImages();
      if (images.length > 0) {
        this.currentIndex.update(prev => (prev + 1) % images.length);
      }
    }, 5000); // Change slide every 5 seconds
  }

  stopSlider(): void {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
    }
  }

  goToSlide(index: number): void {
    this.currentIndex.set(index);
    this.stopSlider();
    this.startSlider();
  }

  login(): void {
    this.authService.loginWithGoogle();
  }

  logout(): void {
    this.authService.logout();
  }

  openLoginModal() {
    this.isLoginModalOpen.set(true);
  }

  closeLoginModal() {
    this.isLoginModalOpen.set(false);
  }

  navigateTo(path: string) {
    this.router.navigate([path]);
    this.closeLoginModal();
  }
}