import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ShopSettings } from '../../models';

@Component({
  selector: 'app-layout-preview',
  templateUrl: './layout-preview.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe],
})
export class LayoutPreviewComponent {
  layout = input.required<ShopSettings['layout']>();
  
  currentView = signal<'products' | 'cart' | 'checkout'>('products');
}