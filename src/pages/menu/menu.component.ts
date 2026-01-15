import { ChangeDetectionStrategy, Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { CartService } from '../../services/cart.service';
import { AuthService } from '../../services/auth.service';
import { ImageUploadService } from '../../services/image-upload.service';
import { Product, AddonCategory, ProductSize, Addon, CartItem, Order, NeighborhoodFee, DayOpeningHours, Coupon } from '../../models';

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ReactiveFormsModule, CurrencyPipe, DatePipe]
})
export class MenuComponent implements OnInit {
  private dataService: DataService = inject(DataService);
  cartService: CartService = inject(CartService);
  private authService: AuthService = inject(AuthService);
  private imageUploadService: ImageUploadService = inject(ImageUploadService);
  private fb: FormBuilder = inject(FormBuilder);

  settings = this.dataService.settings;
  categories = computed(() => this.dataService.categories().sort((a, b) => a.order - b.order));
  products = this.dataService.products;
  coupons = this.dataService.coupons;
  shopStatus = computed(() => this.dataService.isShopOpen());
  user = this.authService.currentUser;

  selectedCategory = signal<string>('all');
  searchTerm = signal('');
  
  filteredProducts = computed(() => {
    const allProducts = this.products().sort((a,b) => a.order - b.order);
    const catId = this.selectedCategory();
    const term = this.searchTerm().toLowerCase();

    let products = allProducts;

    if (catId !== 'all') {
      products = products.filter(p => p.category_id === catId);
    }

    if (term) {
      products = products.filter(p => p.name.toLowerCase().includes(term));
    }
    
    return products;
  });

  isProductModalOpen = signal(false);
  selectedProduct = signal<Product | null>(null);
  selectedSize = signal<ProductSize | null>(null);
  selectedAddons = signal<{[key: string]: Addon}>({});
  productQuantity = signal(1);
  productNotes = signal('');

  isAddToCartDisabled = computed(() => {
    const product = this.selectedProduct();
    if (!product) return true;

    // 1. Size check
    const priceType = product.price_type || (product.sizes && product.sizes.length > 0 ? 'sized' : 'fixed');
    if (priceType === 'sized' && !this.selectedSize()) {
      return true;
    }

    // 2. Addon selections check
    const allProductAddonCategories = product.addon_categories
      .map(catId => this.getAddonCategoryById(catId))
      .filter((cat): cat is AddonCategory => !!cat);

    const selectedAddonsInScope = this.selectedAddons();

    for (const cat of allProductAddonCategories) {
      const categoryAddonIds = new Set(cat.addons.map(a => a.id));
      const selectionsInCatCount = Object.keys(selectedAddonsInScope).filter(id => categoryAddonIds.has(id)).length;
      
      const min = cat.min_selection || (cat.required ? 1 : 0);
      const max = cat.max_selection || 0; // 0 means unlimited

      if (selectionsInCatCount < min) {
        return true; // Minimum not met
      }
      if (max > 0 && selectionsInCatCount > max) {
        // This case should be prevented by toggleAddon, but good to have as a safeguard.
        return true; // Maximum exceeded
      }
    }

    return false;
  });

  isCartSidebarOpen = signal(false);

  isCheckoutModalOpen = signal(false);
  checkoutStep = signal(1); // 1 for info, 2 for review
  pixProofFile = signal<File | null>(null);
  pixProofPreview = signal<string | null>(null);
  hasCheckoutData = signal(false);
  isSubmittingOrder = signal(false);

  isCouponsModalOpen = signal(false);
  isAvailableCouponsModalOpen = signal(false);
  appliedCoupon = signal<Coupon | null>(null);
  couponCodeInput = signal('');
  couponError = signal<string | null>(null);

  isLoyaltyModalOpen = signal(false);
  appliedLoyaltyDiscount = signal(0);
  appliedLoyaltyFreeShipping = signal(false);

  currentDeliveryFee = signal(0);
  
  discountAmount = computed(() => {
    const coupon = this.appliedCoupon();
    const subtotal = this.cartService.subtotal();
    if (!coupon || subtotal <= 0) return 0;
    if (coupon.minimum_order_value && subtotal < coupon.minimum_order_value) return 0;
    if (coupon.discount_type === 'fixed') return Math.min(coupon.discount_value, subtotal);
    if (coupon.discount_type === 'percentage') return (subtotal * coupon.discount_value) / 100;
    return 0;
  });
  
  shippingDiscount = computed(() => {
    const coupon = this.appliedCoupon();
    const subtotal = this.cartService.subtotal();
    if (!coupon || subtotal <= 0 || coupon.discount_type !== 'free_shipping') return 0;
    if (coupon.minimum_order_value && subtotal < coupon.minimum_order_value) return 0;
    return this.currentDeliveryFee();
  });
  
  loyaltyShippingDiscount = computed(() => this.appliedLoyaltyFreeShipping() ? this.currentDeliveryFee() : 0);

  total = computed(() => {
    const newTotal = this.cartService.subtotal() + this.currentDeliveryFee() - this.discountAmount() - this.shippingDiscount() - this.appliedLoyaltyDiscount() - this.loyaltyShippingDiscount();
    return Math.max(0, newTotal);
  });

  availableCoupons = computed(() => {
    const allCoupons = this.coupons();
    const usedCodes = this.user()?.used_coupons || [];
    return allCoupons.filter(c => !usedCodes.includes(c.code));
  });

  remainingLoyaltyPoints = computed(() => {
    const currentUser = this.user();
    const loyaltySettings = this.settings().loyalty_program;
    if (!currentUser || !loyaltySettings?.enabled) return 0;
    return Math.max(0, loyaltySettings.points_for_reward - currentUser.loyalty_points);
  });

  trackedOrder = signal<Order | null>(null);
  isTrackingModalOpen = signal(false);
  private readonly TRACKED_ORDER_ID_KEY = 'acai_tracked_order_id';

  isPastOrdersModalOpen = signal(false);
  pastOrders = signal<Order[]>([]);
  private readonly PAST_ORDER_IDS_KEY = 'acai_past_order_ids';
  private readonly LAST_ADDRESS_KEY = 'acai_last_address';

  availableSlots = signal<string[]>([]);

  checkoutForm = this.fb.group({
    customer_name: ['', Validators.required],
    delivery_option: ['delivery', Validators.required],
    street: ['', Validators.required],
    number: ['', Validators.required],
    complement: [''],
    reference: [''],
    neighborhood: ['', Validators.required],
    payment_method: ['pix-machine', Validators.required],
    change_for: [{value: '', disabled: true}],
    scheduled_time: ['']
  });

  now = new Date();

  paymentMethodNames: { [key: string]: string } = {
    'pix-machine': 'PIX na Maquininha',
    'card': 'Cartão de Crédito/Débito',
    'cash': 'Dinheiro',
    'pix-online': 'PIX (enviar comprovante)'
  };

  constructor() {
    effect(() => {
        const allOrders = this.dataService.orders();
        const trackedId = this.loadTrackedOrderId();
        if (trackedId) {
            this.trackedOrder.set(allOrders.find(o => o.id === trackedId) || null);
        }
        const pastOrderIds = this.getPastOrderIds();
        if (pastOrderIds.length > 0) {
          const userOrders = allOrders.filter(o => pastOrderIds.includes(o.id));
          this.pastOrders.set(userOrders.sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
        }
    });
    
    effect(() => {
      const currentUser = this.user();
      if(currentUser && this.checkoutForm.get('customer_name')?.value === '') {
        this.checkoutForm.get('customer_name')?.setValue(currentUser.name);
      }
    });

    this.checkoutForm.get('payment_method')?.valueChanges.subscribe(value => {
        const changeForControl = this.checkoutForm.get('change_for');
        if (value === 'cash') changeForControl?.enable();
        else { changeForControl?.disable(); changeForControl?.reset(); }
    });

    this.checkoutForm.get('delivery_option')?.valueChanges.subscribe(value => {
        const controlsToManage = {
            street: this.checkoutForm.get('street'), number: this.checkoutForm.get('number'),
            complement: this.checkoutForm.get('complement'), reference: this.checkoutForm.get('reference'),
            neighborhood: this.checkoutForm.get('neighborhood'),
        };
        if (value === 'pickup') {
            Object.values(controlsToManage).forEach(control => { control?.clearValidators(); control?.reset(); });
        } else {
            controlsToManage.street?.setValidators(Validators.required);
            controlsToManage.number?.setValidators(Validators.required);
            controlsToManage.neighborhood?.setValidators(Validators.required);
            controlsToManage.complement?.clearValidators();
            controlsToManage.reference?.clearValidators();
        }
        Object.values(controlsToManage).forEach(control => control?.updateValueAndValidity());
        this.updateDeliveryFee();
    });

    this.checkoutForm.get('neighborhood')?.valueChanges.subscribe(() => {
        if(this.checkoutForm.get('delivery_option')?.value === 'delivery') this.updateDeliveryFee();
    });
  }
  
  ngOnInit() {}

  get todaysHours(): string {
      const { hoursToday } = this.shopStatus();
      if (!hoursToday || !hoursToday.is_open) return 'Fechado hoje';
      return `${hoursToday.start} - ${hoursToday.end}`;
  }

  updateDeliveryFee() {
    const deliverySettings = this.settings().delivery;
    if (this.checkoutForm.get('delivery_option')?.value === 'pickup') { this.currentDeliveryFee.set(0); return; }
    if (deliverySettings.type === 'fixed') { this.currentDeliveryFee.set(deliverySettings.fixed_fee); }
    else {
        const selectedHoodName = this.checkoutForm.get('neighborhood')?.value;
        const hood = deliverySettings.neighborhoods.find(h => h.name === selectedHoodName);
        this.currentDeliveryFee.set(hood ? hood.fee : 0);
    }
  }

  openProductModal(product: Product) {
    if (!product.is_available) return;
    this.selectedProduct.set(product);
    this.selectedSize.set(null);
    this.productQuantity.set(1);
    this.selectedAddons.set({});
    this.productNotes.set('');
    this.isProductModalOpen.set(true);
  }

  closeProductModal() { this.isProductModalOpen.set(false); }
  incrementProductQuantity() { this.productQuantity.update(q => q + 1); }
  decrementProductQuantity() { this.productQuantity.update(q => q > 1 ? q - 1 : 1); }

  private getAddonCategoryByAddonId(addonId: string): AddonCategory | undefined {
    return this.dataService.addonCategories().find(cat => cat.addons.some(a => a.id === addonId));
  }

  toggleAddon(addon: Addon) {
    if (!addon.is_available) return;

    const addonCat = this.getAddonCategoryByAddonId(addon.id);
    if (!addonCat) return;

    const max = addonCat.max_selection || 0; // 0 is unlimited
    const currentAddons = { ...this.selectedAddons() };

    if (currentAddons[addon.id]) {
      // It's a deselection, always allowed.
      delete currentAddons[addon.id];
    } else {
      // It's a selection, check against max.
      const categoryAddonIds = new Set(addonCat.addons.map(a => a.id));
      const selectionsInCatCount = Object.keys(currentAddons).filter(id => categoryAddonIds.has(id)).length;

      if (max > 0 && selectionsInCatCount >= max) {
        alert(`Você pode selecionar no máximo ${max} ${max === 1 ? 'opção' : 'opções'} para "${addonCat.name}".`);
        return; // Prevent selection
      }
      currentAddons[addon.id] = addon;
    }
    
    this.selectedAddons.set(currentAddons);
  }

  addToCart() {
    const product = this.selectedProduct(); if (!product) return;
    let size: ProductSize;
    const priceType = product.price_type || (product.sizes && product.sizes.length > 0 ? 'sized' : 'fixed');
    if (priceType === 'fixed') { size = { name: 'Único', price: product.price ?? 0, is_available: true }; }
    else { const selected = this.selectedSize(); if (!selected || !selected.is_available) { alert('Selecione um tamanho.'); return; } size = selected; }
    
    const addons: Addon[] = Object.values(this.selectedAddons());
    
    this.cartService.addItem(product.id, product.name, size, addons, this.productQuantity(), this.productNotes());
    this.closeProductModal();
    this.isCartSidebarOpen.set(true);
  }
  
  getAddonCategoryById(id: string): AddonCategory | undefined {
    return this.dataService.addonCategories().find(ac => ac.id === id);
  }

  getAddonNames(addons: Addon[]): string { return addons.map(a => a.name).join(', '); }

  getGroupedAddons(item: CartItem): { categoryName: string, addons: Addon[] }[] {
    const product = this.products().find(p => p.id === item.product_id);
    if (!product || !item.addons || item.addons.length === 0) return [];
    const itemAddonIds = new Set(item.addons.map(a => a.id));
    const grouped: { categoryName: string, addons: Addon[] }[] = [];
    const productAddonCategories = this.dataService.addonCategories()
      .filter(ac => product.addon_categories.includes(ac.id))
      .sort((a,b) => a.order - b.order);
    for (const category of productAddonCategories) {
      const addonsInCategory = category.addons.filter(addon => itemAddonIds.has(addon.id));
      if (addonsInCategory.length > 0) {
        grouped.push({ categoryName: category.name, addons: addonsInCategory.sort((a,b) => a.order - b.order) });
      }
    }
    return grouped;
  }
  
  startCheckout() {
    this.isCartSidebarOpen.set(false);
    this.checkoutStep.set(1);
    this.loadLastAddress();
    this.generateTimeSlots();
    this.isCheckoutModalOpen.set(true);
  }
  
  closeCheckout() {
    this.isCheckoutModalOpen.set(false);
    this.pixProofFile.set(null);
    this.pixProofPreview.set(null);
  }

  addMoreItems() {
    this.closeCheckout();
    this.isCartSidebarOpen.set(true);
  }

  private generateTimeSlots() {
    const { hoursToday } = this.shopStatus();
    if (!hoursToday || !hoursToday.is_open) {
      this.availableSlots.set([]);
      return;
    }
    
    const slots = [];
    const now = new Date();
    const [startH, startM] = hoursToday.start.split(':').map(Number);
    const [endH, endM] = hoursToday.end.split(':').map(Number);
    
    let slotTime = new Date();
    slotTime.setHours(startH, startM, 0, 0);

    let currentTime = new Date();
    currentTime.setMinutes(currentTime.getMinutes() + 30); // Start slots 30 mins from now
    
    if (slotTime < currentTime) slotTime = currentTime;

    const endTime = new Date();
    endTime.setHours(endH, endM, 0, 0);

    while (slotTime <= endTime) {
      const hours = slotTime.getHours().toString().padStart(2, '0');
      const minutes = slotTime.getMinutes().toString().padStart(2, '0');
      slots.push(`${hours}:${minutes}`);
      slotTime.setMinutes(slotTime.getMinutes() + 15);
    }
    
    this.availableSlots.set(slots);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.pixProofFile.set(file);
      const reader = new FileReader();
      reader.onload = (e) => this.pixProofPreview.set(e.target?.result as string);
      reader.readAsDataURL(file);
    }
  }

  copyPixKey() { navigator.clipboard.writeText(this.settings().pix_key); alert('Chave PIX copiada!'); }

  goToReviewStep() {
    this.checkoutForm.markAllAsTouched();
    if (this.checkoutForm.invalid) {
      alert('Por favor, preencha todos os campos obrigatórios.'); return;
    }
    if (this.checkoutForm.get('payment_method')?.value === 'pix-online' && !this.pixProofFile()) {
      alert('Por favor, anexe o comprovante do PIX.'); return;
    }
    this.now = new Date();
    this.checkoutStep.set(2);
  }
  
  get composedAddress(): string {
    const { street, number, complement, reference } = this.checkoutForm.value;
    return [`${street || ''}, ${number || ''}`, complement, reference ? `(Ref: ${reference})` : ''].filter(p => p).join(' - ');
  }

  async finalizeOrder() {
    if (this.isSubmittingOrder()) return;
    this.isSubmittingOrder.set(true);

    try {
      const formValue = this.checkoutForm.getRawValue();
      let pixProofUrl: string | undefined;
      if (this.pixProofFile()) {
        pixProofUrl = await this.imageUploadService.uploadImage(this.pixProofFile()!, 'proofs');
      }

      const order: Omit<Order, 'id' | 'date' | 'status'> = {
        customer_name: formValue.customer_name,
        delivery_option: formValue.delivery_option as 'delivery' | 'pickup',
        delivery_address: formValue.delivery_option === 'delivery' ? this.composedAddress : undefined,
        neighborhood: formValue.delivery_option === 'delivery' ? formValue.neighborhood : undefined,
        payment_method: formValue.payment_method as any,
        change_for: formValue.payment_method === 'cash' ? Number(formValue.change_for) || undefined : undefined,
        pix_proof_url: pixProofUrl,
        items: this.cartService.items(),
        subtotal: this.cartService.subtotal(),
        delivery_fee: this.currentDeliveryFee(),
        total: this.total(),
        coupon_code: this.appliedCoupon()?.code,
        discount_amount: this.discountAmount(),
        shipping_discount_amount: this.shippingDiscount(),
        loyalty_discount_amount: this.appliedLoyaltyDiscount(),
        loyalty_shipping_discount_amount: this.loyaltyShippingDiscount(),
        scheduled_time: formValue.scheduled_time || undefined
      };

      const whatsappNumber = this.settings().whatsapp;
      const isScheduled = !!order.scheduled_time;
      let message = isScheduled ? `*NOVO PEDIDO AGENDADO* \n\n` : `*NOVO PEDIDO* \n\n`;
      message += `*Cliente:* ${order.customer_name}\n`;
      if(order.scheduled_time) message += `*Horário:* ${order.scheduled_time}\n`;
      message += `*Entrega:* ${order.delivery_option === 'delivery' ? 'Delivery' : 'Retirada na Loja'}\n`;
      if (order.delivery_option === 'delivery') {
        message += `*Endereço:* ${order.delivery_address}\n*Bairro:* ${order.neighborhood}\n`;
      }
      message += `\n*Itens do Pedido:*\n`;

      const currencyPipe = new CurrencyPipe('pt-BR');

      order.items.forEach(item => {
        message += `*- ${item.quantity}x ${item.product_name} ${item.size.name !== 'Único' ? `(${item.size.name})` : ''}*\n`;
        if (item.notes) {
            message += `  *Obs:* ${item.notes}\n`;
        }
        if (item.addons.length > 0) {
          message += `  *Adicionais:*\n`;
          item.addons.forEach(addon => {
            const addonPriceText = addon.price > 0 ? currencyPipe.transform(addon.price, 'BRL', 'symbol', '1.2-2') : 'Grátis';
            message += `    - ${addon.name} (+ ${addonPriceText})\n`;
          });
        }
      });
      
      message += `\n*Subtotal:* ${currencyPipe.transform(order.subtotal, 'BRL', 'symbol', '1.2-2')}\n`;
      if (order.delivery_fee > 0) message += `*Taxa de Entrega:* ${currencyPipe.transform(order.delivery_fee, 'BRL', 'symbol', '1.2-2')}\n`;
      if ((order.discount_amount ?? 0) > 0) message += `*Desconto:* -${currencyPipe.transform(order.discount_amount, 'BRL', 'symbol', '1.2-2')}\n`;
      if ((order.shipping_discount_amount ?? 0) > 0) message += `*Desc. Frete:* -${currencyPipe.transform(order.shipping_discount_amount, 'BRL', 'symbol', '1.2-2')}\n`;
      if ((order.loyalty_discount_amount ?? 0) > 0) message += `*Desc. Fidelidade:* -${currencyPipe.transform(order.loyalty_discount_amount, 'BRL', 'symbol', '1.2-2')}\n`;
      if ((order.loyalty_shipping_discount_amount ?? 0) > 0) message += `*Frete Grátis (Fidelidade):* -${currencyPipe.transform(order.loyalty_shipping_discount_amount, 'BRL', 'symbol', '1.2-2')}\n`;
      message += `*TOTAL:* *${currencyPipe.transform(order.total, 'BRL', 'symbol', '1.2-2')}*\n\n`;
      message += `*Forma de Pagamento:* ${this.paymentMethodNames[order.payment_method] || order.payment_method}\n`;
      if (order.payment_method === 'cash' && order.change_for) {
        message += `*Troco para:* ${currencyPipe.transform(order.change_for, 'BRL', 'symbol', '1.2-2')}\n`;
      }

      const newOrder = await this.dataService.addOrder(order);
      this.trackOrder(newOrder.id);
      this.savePastOrderId(newOrder.id);
      if (order.delivery_option === 'delivery') this.saveLastAddress();

      // Mark coupon as used
      if (this.appliedCoupon()) {
        this.authService.useCoupon(this.appliedCoupon()!.code);
      }

      this.authService.addLoyaltyPoints(order.subtotal, this.settings());
      if (this.appliedLoyaltyDiscount() > 0 || this.appliedLoyaltyFreeShipping()) {
        this.authService.redeemLoyaltyPoints(this.settings());
      }
      
      this.cartService.clearCart();
      this.closeCheckout();
      
      const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
      window.open(whatsappUrl, '_blank');

    } catch (error) {
      console.error('Failed to save order:', error);
      alert('Houve um erro ao registrar seu pedido. Tente novamente.');
    } finally {
      this.isSubmittingOrder.set(false);
    }
  }

  private trackOrder(orderId: string) {
    localStorage.setItem(this.TRACKED_ORDER_ID_KEY, orderId);
    this.trackedOrder.set(this.dataService.orders().find(o => o.id === orderId) || null);
  }
  
  private loadTrackedOrderId(): string | null {
    return localStorage.getItem(this.TRACKED_ORDER_ID_KEY);
  }

  clearTrackedOrder() {
    localStorage.removeItem(this.TRACKED_ORDER_ID_KEY);
    this.trackedOrder.set(null);
    this.isTrackingModalOpen.set(false);
  }

  private savePastOrderId(orderId: string) {
    let ids = this.getPastOrderIds();
    if (!ids.includes(orderId)) {
        ids.push(orderId);
        localStorage.setItem(this.PAST_ORDER_IDS_KEY, JSON.stringify(ids));
    }
  }

  private getPastOrderIds(): string[] {
    const stored = localStorage.getItem(this.PAST_ORDER_IDS_KEY);
    return stored ? JSON.parse(stored) : [];
  }
  
  openPastOrdersModal() {
    this.pastOrders.set(
      this.dataService.orders()
        .filter(o => this.getPastOrderIds().includes(o.id))
        .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    );
    this.isPastOrdersModalOpen.set(true);
  }

  private saveLastAddress() {
      const { street, number, complement, reference, neighborhood } = this.checkoutForm.getRawValue();
      const address = { street, number, complement, reference, neighborhood };
      localStorage.setItem(this.LAST_ADDRESS_KEY, JSON.stringify(address));
  }

  private loadLastAddress() {
      const stored = localStorage.getItem(this.LAST_ADDRESS_KEY);
      if (stored) {
          const address = JSON.parse(stored);
          this.checkoutForm.patchValue(address);
          this.updateDeliveryFee();
      }
  }

  applyCoupon(code: string) {
    this.couponError.set(null);
    const user = this.user();
    if (user?.used_coupons?.includes(code.toLowerCase())) {
      this.couponError.set('Este cupom já foi utilizado por você.');
      return;
    }
    const coupon = this.coupons().find(c => c.code.toLowerCase() === code.toLowerCase());
    if (!coupon) { this.couponError.set('Cupom inválido.'); return; }
    if (coupon.minimum_order_value && this.cartService.subtotal() < coupon.minimum_order_value) {
      this.couponError.set(`Pedido mínimo de ${new CurrencyPipe('pt-BR').transform(coupon.minimum_order_value, 'BRL')} necessário.`); return;
    }
    this.appliedCoupon.set(coupon);
    this.appliedLoyaltyDiscount.set(0);
    this.appliedLoyaltyFreeShipping.set(false);
    this.couponCodeInput.set('');
    this.isCouponsModalOpen.set(false);
  }
  
  removeCoupon() { this.appliedCoupon.set(null); }

  applyLoyaltyReward() {
    const user = this.user();
    const settings = this.settings().loyalty_program;
    if (!user || !settings.enabled || user.loyalty_points < settings.points_for_reward) return;

    this.removeCoupon();
    if(settings.reward_type === 'fixed') {
      this.appliedLoyaltyDiscount.set(settings.reward_value);
      this.appliedLoyaltyFreeShipping.set(false);
    } else {
      this.appliedLoyaltyDiscount.set(0);
      this.appliedLoyaltyFreeShipping.set(true);
    }
    this.isLoyaltyModalOpen.set(false);
    this.isCartSidebarOpen.set(true);
  }

  removeLoyaltyReward() {
    this.appliedLoyaltyDiscount.set(0);
    this.appliedLoyaltyFreeShipping.set(false);
  }
}