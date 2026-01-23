import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { WheelOfFortuneComponent } from '../../components/wheel-of-fortune/wheel-of-fortune.component';
import { DataService } from '../../services/data.service';
import { Coupon, WheelPrize } from '../../models';

@Component({
  selector: 'app-wheel-page',
  templateUrl: './wheel-page.component.html',
  imports: [WheelOfFortuneComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WheelPageComponent {
  private dataService = inject(DataService);
  settings = this.dataService.settings;
  
  wonPrize = signal<WheelPrize | null>(null);

  handlePrize(prize: WheelPrize) {
    // Apenas exibe o prêmio ganho para o usuário.
    // A lógica de criação/aplicação do cupom é feita no PDV ou no menu.
    this.wonPrize.set(prize);
  }

  sendCouponToWhatsapp(): void {
    const prize = this.wonPrize();
    const settings = this.settings();
    if (!prize || !prize.couponCode || !settings.whatsapp) {
      return;
    }

    const message = `Olá! Acabei de ganhar o cupom *${prize.couponCode}* (${prize.label}) na Roleta da Sorte e gostaria de usá-lo na minha compra!`;
    const whatsappNumber = settings.whatsapp.replace(/\D/g, '');
    const url = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  }
}
