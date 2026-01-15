import { ChangeDetectionStrategy, Component, input, output, inject } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Order, ShopSettings, Addon, CartItem, Product, AddonCategory } from '../../models';
import { DataService } from '../../services/data.service';

@Component({
  selector: 'app-receipt',
  templateUrl: './receipt.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, DatePipe],
})
export class ReceiptComponent {
  order = input.required<Order>();
  settings = input.required<ShopSettings>();
  mode = input<'print' | 'delivery' | 'pdv'>('print');
  close = output<void>();
  confirm = output<void>();
  sendWhatsApp = output<void>();

  private dataService = inject(DataService);
  private products = this.dataService.products;
  private addonCategories = this.dataService.addonCategories;

  paymentMethodNames: { [key: string]: string } = {
    'pix-machine': 'PIX na Maquininha',
    'card': 'Cartão de Crédito/Débito',
    'cash': 'Dinheiro',
    'pix-online': 'PIX (enviar comprovante)',
    'counter': 'Venda Balcão',
    'credit': 'Fiado'
  };

  printReceipt(): void {
    window.print();
  }

  confirmAction(): void {
    this.confirm.emit();
  }

  getGroupedAddons(item: CartItem): { categoryName: string, addons: Addon[] }[] {
    const product = this.products().find(p => p.id === item.product_id);
    if (!product || !item.addons || item.addons.length === 0) {
      return [];
    }

    const itemAddonIds = new Set(item.addons.map(a => a.id));
    const grouped: { categoryName: string, addons: Addon[] }[] = [];

    const productAddonCategories = this.addonCategories()
      .filter(ac => product.addon_categories.includes(ac.id))
      .sort((a,b) => a.order - b.order);

    for (const category of productAddonCategories) {
      const addonsInCategory = category.addons.filter(addon => itemAddonIds.has(addon.id));
      if (addonsInCategory.length > 0) {
        grouped.push({
          categoryName: category.name,
          addons: addonsInCategory.sort((a,b) => a.order - b.order)
        });
      }
    }

    return grouped;
  }
}