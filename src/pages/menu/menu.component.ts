import { ChangeDetectionStrategy, Component, inject, signal, computed, effect, OnInit } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators, FormGroup } from '@angular/forms';
import { DataService } from '../../services/data.service';
import { CartService } from '../../services/cart.service';
import { AuthService } from '../../services/auth.service';
import { ImageUploadService } from '../../services/image-upload.service';
import { Product, AddonCategory, ProductSize, Addon, CartItem, Order, NeighborhoodFee, DayOpeningHours, Coupon, WheelPrize } from '../../models';
import { WheelOfFortuneComponent } from '../../components/wheel-of-fortune/wheel-of-fortune.component';

type FreePrizeProduct = { product: Product, eligibleSizes: ProductSize[] };

@Component({
  selector: 'app-menu',
  templateUrl: './menu.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ReactiveFormsModule, CurrencyPipe, DatePipe, WheelOfFortuneComponent]
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
  private dbCoupons = this.dataService.coupons; // Renamed to indicate source
  shopStatus = computed(() => this.dataService.isShopOpen());
  user = this.authService.currentUser;

  // State for temporary, component-level coupons (e.g., from wheel)
  private componentCoupons = signal<Coupon[]>([]);

  // Combined list of coupons from database and temporary ones
  coupons = computed(() => [...this.dbCoupons(), ...this.componentCoupons()]);

  selectedCategory = signal<string>('all');
  searchTerm = signal('');
  
  filteredProducts = computed(() => {
    const allProducts = this.products();
    const catId = this.selectedCategory();
    const term = this.searchTerm().toLowerCase();

    if (catId === 'all') {
      return [];
    }

    let products = allProducts.filter(p => p.category_id === catId);

    if (term) {
      products = products.filter(p => p.name.toLowerCase().includes(term));
    }
    
    return products.sort((a,b) => a.order - b.order);
  });

  groupedProductsWhenAll = computed(() => {
    const allProducts = this.products();
    const allCategories = this.categories();
    const term = this.searchTerm().toLowerCase();

    if (this.selectedCategory() !== 'all') {
        return [];
    }

    let productsToFilter = allProducts;
    if (term) {
        productsToFilter = allProducts.filter(p => p.name.toLowerCase().includes(term));
    }

    return allCategories
        .map(category => {
            const productsForCategory = productsToFilter
                .filter(product => product.category_id === category.id)
                .sort((a, b) => a.order - b.order);

            return {
                category,
                products: productsForCategory
            };
        })
        .filter(group => group.products.length > 0);
  });

  isProductModalOpen = signal(false);
  selectedProduct = signal<Product | null>(null);
  selectedSize = signal<ProductSize | null>(null);
  selectedAddons = signal<{[key: string]: Addon}>({});
  productQuantity = signal(1);
  productNotes = signal('');

  modalTotalPrice = computed(() => {
    const product = this.selectedProduct();
    if (!product) return 0;

    const quantity = this.productQuantity();
    
    let sizePrice = 0;
    const priceType = product.price_type || (product.sizes && product.sizes.length > 0 ? 'sized' : 'fixed');
    if (priceType === 'fixed') {
        sizePrice = product.price ?? 0;
    } else {
        sizePrice = this.selectedSize()?.price ?? 0;
    }
    
    // FIX: Explicitly cast the result of Object.values to Addon[] to ensure type safety.
    // This prevents `addon` being inferred as `unknown` inside the reduce function.
    const addonsPrice = (Object.values(this.selectedAddons()) as Addon[]).reduce((sum, addon) => sum + addon.price, 0);
    
    return (sizePrice + addonsPrice) * quantity;
  });

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

  isWheelModalOpen = signal(false);
  canSpinWheel = signal(true);

  isFreePrizeModalOpen = signal(false);
  freePrizeContext = signal<{ products: FreePrizeProduct[], prize: WheelPrize } | null>(null);
  freePrizeStep = signal<'product' | 'size'>('product');
  selectedProductForFreePrize = signal<FreePrizeProduct | null>(null);

  showWheelButton = computed(() => {
    const wheelSettings = this.settings().loyalty_program?.wheel_of_fortune;
    return !!wheelSettings?.enabled && this.canSpinWheel();
  });

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
    if (!coupon || subtotal <= 0 || coupon.discount_type !== 'free_shipping') {
      return 0;
    }
    if (coupon.minimum_order_value && subtotal < coupon.minimum_order_value) {
      return 0;
    }
    return this.currentDeliveryFee();
  });

  loyaltyShippingDiscount = computed(() => {
    if (!this.appliedLoyaltyFreeShipping()) return 0;
    return this.currentDeliveryFee();
  });

  total = computed(() => {
    const subtotal = this.cartService.subtotal();
    const fee = this.currentDeliveryFee();
    const couponDisc = this.discountAmount();
    const shipDisc = this.shippingDiscount();
    const loyaltyDisc = this.appliedLoyaltyDiscount();
    const loyaltyShipDisc = this.loyaltyShippingDiscount();
    return Math.max(0, subtotal + fee - couponDisc - shipDisc - loyaltyDisc - loyaltyShipDisc);
  });

  // Logic for free product minimum requirement
  freeProductRequirement = signal(0);
  paidItemsSubtotal = computed(() => {
    return this.cartService.items()
      .filter(item => item.notes !== 'Prêmio da Roleta')
      .reduce((acc, item) => acc + item.total_price, 0);
  });
  isCheckoutBlockedByFreebie = computed(() => {
    const requirement = this.freeProductRequirement();
    return requirement > 0 && this.paidItemsSubtotal() < requirement;
  });
  remainingForFreebie = computed(() => {
    const requirement = this.freeProductRequirement();
    if (requirement > 0) {
      return Math.max(0, requirement - this.paidItemsSubtotal());
    }
    return 0;
  });

  checkoutForm: FormGroup;
  now = new Date();

  trackedOrder = signal<Order | null>(null);
  isTrackingModalOpen = signal(false);
  pastOrders = signal<Order[]>([]);
  isPastOrdersModalOpen = signal(false);

  constructor() {
    this.checkoutForm = this.fb.group({
      customer_name: ['', Validators.required],
      delivery_option: ['delivery', Validators.required],
      street: [''],
      number: [''],
      neighborhood: [''],
      complement: [''],
      reference: [''],
      payment_method: ['pix-machine', Validators.required],
      change_for: [{ value: '', disabled: true }],
      scheduled_time: ['']
    });

    effect(() => {
      const deliveryOption = this.checkoutForm.get('delivery_option')?.value;
      const addressControls = ['street', 'number', 'neighborhood'];
      if (deliveryOption === 'delivery') {
        addressControls.forEach(name => this.checkoutForm.get(name)?.setValidators(Validators.required));
      } else {
        addressControls.forEach(name => {
          this.checkoutForm.get(name)?.clearValidators();
          this.checkoutForm.get(name)?.reset('');
        });
      }
      addressControls.forEach(name => this.checkoutForm.get(name)?.updateValueAndValidity());
      this.updateDeliveryFee();
    });

    this.checkoutForm.get('neighborhood')?.valueChanges.subscribe(() => {
      this.updateDeliveryFee();
    });

    this.checkoutForm.get('payment_method')?.valueChanges.subscribe(value => {
      const changeForControl = this.checkoutForm.get('change_for');
      if (value === 'cash') {
        changeForControl?.enable();
      } else {
        changeForControl?.disable();
        changeForControl?.reset('');
      }
    });
    
    effect(() => {
        const user = this.user();
        if(user) {
            this.checkoutForm.patchValue({ customer_name: user.name });
            this.loadPastOrders();
        }
    });

    effect(() => {
        const orderId = this.getTrackedOrderId();
        if (orderId) {
            const allOrders = this.dataService.orders();
            const order = allOrders.find(o => o.id === orderId);
            this.trackedOrder.set(order ?? null);
        } else {
            this.trackedOrder.set(null);
        }
    });

    effect(() => {
      const items = this.cartService.items();
      const hasFreeItem = items.some(item => item.notes === 'Prêmio da Roleta');
      if (!hasFreeItem) {
        this.freeProductRequirement.set(0);
      }
    });

    // Definitive fix for the checkout button issue.
    // This effect ensures that whenever the checkout modal is opened,
    // the cart sidebar is closed as a reaction. This decouples the two
    // UI actions and prevents the race condition where the button was
    // being removed from the DOM before its click event was fully processed.
    effect(() => {
      if (this.isCheckoutModalOpen()) {
        this.isCartSidebarOpen.set(false);
      }
    });
  }

  ngOnInit() {
      const categories = this.categories();
      if(categories.length > 0) {
          this.selectedCategory.set(categories[0].id);
      }
       if (this.isBrowser()) {
        const hasSpun = sessionStorage.getItem('hasSpunWheel');
        if (hasSpun) {
          this.canSpinWheel.set(false);
        }
      }
  }

  loadPastOrders(): void {
    if (!this.isBrowser()) return;
    try {
        const orderHistoryJson = localStorage.getItem('acai_order_history');
        const orderIds = orderHistoryJson ? JSON.parse(orderHistoryJson) : [];
        const allOrders = this.dataService.orders();
        const userOrders = allOrders
            .filter(o => orderIds.includes(o.id))
            .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        this.pastOrders.set(userOrders);
    } catch (e) {
        console.error('Error loading past orders', e);
        this.pastOrders.set([]);
    }
  }

  openPastOrdersModal(): void {
      this.loadPastOrders();
      this.isPastOrdersModalOpen.set(true);
  }

  private getTrackedOrderId(): string | null {
    if (!this.isBrowser()) return null;
    return localStorage.getItem('acai_tracked_order_id');
  }

  private setTrackedOrderId(orderId: string): void {
    if (!this.isBrowser()) return;
    localStorage.setItem('acai_tracked_order_id', orderId);
    this.trackedOrder.set(this.dataService.orders().find(o => o.id === orderId) || null);
  }

  clearTrackedOrder(): void {
    if (!this.isBrowser()) return;
    localStorage.removeItem('acai_tracked_order_id');
    this.trackedOrder.set(null);
    this.isTrackingModalOpen.set(false);
  }

  isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof window.document !== 'undefined';
  }

  todaysHours = computed(() => {
    const hours = this.shopStatus().hoursToday;
    if (!hours || !hours.is_open) return 'Fechado';
    return `${hours.start} - ${hours.end}`;
  });

  openProductModal(product: Product) {
    if (!product.is_available) return;
    this.selectedProduct.set(product);
    this.productQuantity.set(1);
    this.selectedAddons.set({});
    this.productNotes.set('');
    
    const priceType = product.price_type || (product.sizes && product.sizes.length > 0 ? 'sized' : 'fixed');
    if (priceType === 'sized' && product.sizes?.length > 0) {
      this.selectedSize.set(product.sizes[0]);
    } else {
      this.selectedSize.set(null);
    }
    
    this.isProductModalOpen.set(true);
  }

  closeProductModal() {
    this.isProductModalOpen.set(false);
  }

  incrementProductQuantity() {
    this.productQuantity.update(q => q + 1);
  }

  decrementProductQuantity() {
    this.productQuantity.update(q => (q > 1 ? q - 1 : 1));
  }

  getAddonCategoryById(id: string): AddonCategory | undefined {
    return this.dataService.addonCategories().find(ac => ac.id === id);
  }

  toggleAddon(addon: Addon) {
    if (!addon.is_available) return;
    const currentAddons = { ...this.selectedAddons() };
    if (currentAddons[addon.id]) {
      delete currentAddons[addon.id];
    } else {
      currentAddons[addon.id] = addon;
    }
    this.selectedAddons.set(currentAddons);
  }

  addToCart() {
    const product = this.selectedProduct();
    if (!product || this.isAddToCartDisabled()) return;

    let size: ProductSize;
    const priceType = product.price_type || (product.sizes && product.sizes.length > 0 ? 'sized' : 'fixed');
    if(priceType === 'fixed') {
        size = { name: 'Único', price: product.price ?? 0, is_available: true };
    } else {
        const selected = this.selectedSize();
        if(!selected) {
            alert('Por favor, selecione um tamanho.');
            return;
        }
        size = selected;
    }

    this.cartService.addItem(
      product.id,
      product.name,
      size,
      Object.values(this.selectedAddons()),
      this.productQuantity(),
      this.productNotes()
    );
    this.closeProductModal();
    this.isCartSidebarOpen.set(true);
  }
  
  startCheckout() {
    if (!this.shopStatus().is_open || this.shopStatus().is_temporarily_closed) {
      alert('A loja está fechada no momento e não aceita pedidos.');
      return;
    }
    if (this.isCheckoutBlockedByFreebie()) {
      const remaining = this.remainingForFreebie().toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
      alert(`Você precisa adicionar mais ${remaining} em produtos para resgatar seu prêmio!`);
      return;
    }

    // The button's only responsibility is to signal the intent to open the checkout.
    // The new `effect` in the constructor handles closing the sidebar reactively.
    this.isCheckoutModalOpen.set(true);
  }

  closeCheckout() {
    this.isCheckoutModalOpen.set(false);
    this.checkoutStep.set(1);
    this.pixProofFile.set(null);
    this.pixProofPreview.set(null);
  }

  goToReviewStep() {
    this.checkoutForm.markAllAsTouched();
    if(this.checkoutForm.invalid) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }
    this.checkoutStep.set(2);
  }

  composedAddress = computed(() => {
    const { street, number, complement, reference } = this.checkoutForm.value;
    return [`${street || ''}, ${number || ''}`, complement, reference ? `(Ref: ${reference})` : ''].filter(p => p).join(' - ');
  });

  updateDeliveryFee() {
    const settings = this.settings().delivery;
    if (this.checkoutForm.get('delivery_option')?.value !== 'delivery') {
      this.currentDeliveryFee.set(0);
      return;
    }

    if (settings.type === 'fixed') {
      this.currentDeliveryFee.set(settings.fixed_fee);
    } else {
      const neighborhoodName = this.checkoutForm.get('neighborhood')?.value;
      const neighborhood = settings.neighborhoods.find(n => n.name === neighborhoodName);
      this.currentDeliveryFee.set(neighborhood ? neighborhood.fee : 0);
    }
  }

  availableCoupons = computed(() => {
    const subtotal = this.cartService.subtotal();
    return this.coupons().filter(c => c.code && subtotal >= (c.minimum_order_value || 0));
  });

  applyCoupon(code: string) {
    this.couponError.set(null);
    const couponCode = code ? code.toUpperCase().trim() : '';

    if (!couponCode) {
        this.couponError.set('Cupom inválido.');
        return;
    }
    
    const coupon = this.coupons().find(c => c.code && c.code.toUpperCase() === couponCode);

    if (!coupon) {
      this.couponError.set('Cupom inválido.');
      return;
    }

    if (this.user()?.used_coupons?.includes(coupon.code)) {
      this.couponError.set('Você já utilizou este cupom.');
      return;
    }
    
    const subtotal = this.cartService.subtotal();
    if (coupon.minimum_order_value && subtotal < coupon.minimum_order_value) {
      this.couponError.set(`Pedido mínimo de ${coupon.minimum_order_value.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'})} necessário.`);
      return;
    }

    this.appliedCoupon.set(coupon);
    this.isCouponsModalOpen.set(false);
    this.couponCodeInput.set('');
  }

  removeCoupon() {
    this.appliedCoupon.set(null);
  }
  
  remainingLoyaltyPoints = computed(() => {
    const user = this.user();
    if (!user) return 0;
    const pointsNeeded = this.settings().loyalty_program.points_for_reward;
    return Math.max(0, pointsNeeded - user.loyalty_points);
  });
  
  applyLoyaltyReward() {
    const user = this.user();
    const settings = this.settings().loyalty_program;
    if (!user || !settings.enabled || user.loyalty_points < settings.points_for_reward) {
      alert('Você não tem pontos suficientes.');
      return;
    }
    
    if (settings.reward_type === 'fixed') {
      this.appliedLoyaltyDiscount.set(settings.reward_value);
    } else if (settings.reward_type === 'free_shipping') {
      this.appliedLoyaltyFreeShipping.set(true);
    }
    
    this.isLoyaltyModalOpen.set(false);
  }
  
  removeLoyaltyReward() {
    this.appliedLoyaltyDiscount.set(0);
    this.appliedLoyaltyFreeShipping.set(false);
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];
      this.pixProofFile.set(file);
      const reader = new FileReader();
      reader.onload = (e: any) => this.pixProofPreview.set(e.target.result);
      reader.readAsDataURL(file);
    }
  }

  copyPixKey() {
    navigator.clipboard.writeText(this.settings().pix_key);
    alert('Chave PIX copiada!');
  }

  availableSlots = computed(() => {
      const { hoursToday } = this.shopStatus();
      if (!hoursToday || !hoursToday.is_open) return [];
      const slots = [];
      const now = new Date();
      const [startH, startM] = hoursToday.start.split(':').map(Number);
      const [endH, endM] = hoursToday.end.split(':').map(Number);

      let currentHour = now.getHours();
      let currentMinute = now.getMinutes();
      
      // Round up to the next 15-minute interval
      currentMinute = Math.ceil((currentMinute + 1) / 15) * 15;
      if (currentMinute >= 60) {
        currentMinute -= 60;
        currentHour += 1;
      }
      
      const startTime = Math.max(startH * 60 + startM, currentHour * 60 + currentMinute);
      const endTime = endH * 60 + endM;

      for (let time = startTime; time <= endTime; time += 15) {
          const hours = Math.floor(time / 60);
          const minutes = time % 60;
          if (hours < 24) {
              slots.push(`${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`);
          }
      }
      return slots;
  });

  getGroupedAddons(item: CartItem): { categoryName: string, addons: Addon[] }[] {
    const product = this.products().find(p => p.id === item.product_id);
    if (!product) return [];
    return product.addon_categories
      .map(catId => this.getAddonCategoryById(catId))
      .filter((cat): cat is AddonCategory => !!cat)
      .map(cat => ({
        categoryName: cat.name,
        addons: item.addons.filter(addon => cat.addons.some(a => a.id === addon.id))
      }))
      .filter(group => group.addons.length > 0);
  }

  paymentMethodNames: { [key: string]: string } = {
    'pix-machine': 'PIX na Maquininha', 'card': 'Cartão', 'cash': 'Dinheiro', 'pix-online': 'PIX Online', 'credit': 'Fiado'
  };

  openWheelOrShowMessage() {
    const wheelSettings = this.settings().loyalty_program?.wheel_of_fortune;
    const subtotal = this.cartService.subtotal();
    const minValue = wheelSettings?.minimum_order_value || 0;

    if (minValue > 0 && subtotal < minValue) {
        const formattedMinValue = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(minValue);
        alert(`Você precisa ter pelo menos ${formattedMinValue} no carrinho para girar a roleta da sorte!`);
    } else {
        this.isWheelModalOpen.set(true);
    }
  }

  handlePrize(prize: WheelPrize) {
    this.isWheelModalOpen.set(false);
    this.canSpinWheel.set(false);
    if (this.isBrowser()) {
      sessionStorage.setItem('hasSpunWheel', 'true');
    }

    if (prize.type === 'none') {
      return;
    }

    if (prize.type === 'free_product') {
      const allProducts = this.products();
      const eligibleProductMap = new Map<string, FreePrizeProduct>();

      if (prize.eligible_free_products && prize.eligible_free_products.length > 0) {
        for (const eligible of prize.eligible_free_products) {
          const product = allProducts.find(p => p.id === eligible.productId);
          if (product && product.is_available) {
            const size = product.sizes.find(s => s.name === eligible.sizeName && s.is_available);
            if (size) {
              if (!eligibleProductMap.has(product.id)) {
                eligibleProductMap.set(product.id, { product: product, eligibleSizes: [] });
              }
              eligibleProductMap.get(product.id)!.eligibleSizes.push(size);
            }
          }
        }
      }

      const eligibleProducts = Array.from(eligibleProductMap.values());

      if (eligibleProducts.length > 0) {
        this.freePrizeContext.set({ products: eligibleProducts, prize });
        this.freePrizeStep.set('product');
        this.selectedProductForFreePrize.set(null);
        this.isFreePrizeModalOpen.set(true);
      } else {
        alert('Parabéns! Você ganhou um produto grátis, mas não há opções elegíveis disponíveis no momento. Entre em contato com a loja.');
      }
    } else {
      const couponCode = prize.couponCode;

      // Check if a coupon with this code already exists in the main DB list
      const existingCoupon = this.dbCoupons().find(c => c.code && c.code.toUpperCase() === couponCode.toUpperCase());
      
      // If it doesn't exist in DB or local temporary list, create a new temporary one.
      if (!existingCoupon && !this.componentCoupons().find(c => c.code && c.code.toUpperCase() === couponCode.toUpperCase())) {
        const newCoupon: Coupon = {
          id: `WHEEL-${couponCode}-${Date.now()}`,
          code: couponCode,
          description: prize.description,
          discount_type: prize.type as 'percentage' | 'fixed' | 'free_shipping',
          discount_value: prize.value,
          minimum_order_value: 0
        };
        // Add the temporary coupon to the local component list.
        this.componentCoupons.update(c => [...c, newCoupon]);
      }
      
      this.applyCoupon(couponCode);
      this.isCartSidebarOpen.set(true);
    }
  }

  selectFreePrizeProduct(productData: FreePrizeProduct) {
    this.selectedProductForFreePrize.set(productData);
    this.freePrizeStep.set('size');
  }
  
  selectFreePrizeSize(size: ProductSize) {
    const productData = this.selectedProductForFreePrize();
    const prize = this.freePrizeContext()?.prize;
    if (!productData || !prize) return;

    this.cartService.addItem(
      productData.product.id,
      productData.product.name,
      size,
      [],
      1,
      `Prêmio da Roleta`,
      0 // Override price to be free
    );

    this.freeProductRequirement.set(prize.minimum_order_value_for_free_product || 0);

    this.isFreePrizeModalOpen.set(false);
    this.isCartSidebarOpen.set(true);
  }
  
  backToProductSelection() {
    this.freePrizeStep.set('product');
    this.selectedProductForFreePrize.set(null);
  }

  getAddonNames(addons: Addon[]): string {
    return addons.map(a => a.name).join(', ');
  }

  getOrderItemNames(items: CartItem[]): string {
    return items.map(i => `${i.quantity}x ${i.product_name}`).join(', ');
  }

  async finalizeOrder() {
    this.isSubmittingOrder.set(true);
    try {
        const formValue = this.checkoutForm.getRawValue();
        let pixProofUrl: string | undefined;
        if (formValue.payment_method === 'pix-online' && this.total() > 0) {
            const file = this.pixProofFile();
            if (!file) {
                alert('Por favor, anexe o comprovante PIX.');
                this.isSubmittingOrder.set(false);
                return;
            }
            const pathPrefix = `pix_proofs/${Date.now()}`;
            pixProofUrl = await this.imageUploadService.uploadImage(file, pathPrefix);
        }
        
        const order: Omit<Order, 'id' | 'date' | 'status'> = {
            customer_name: formValue.customer_name,
            delivery_option: formValue.delivery_option,
            delivery_address: formValue.delivery_option === 'delivery' ? this.composedAddress() : undefined,
            neighborhood: formValue.delivery_option === 'delivery' ? formValue.neighborhood : undefined,
            payment_method: formValue.payment_method,
            change_for: formValue.payment_method === 'cash' ? Number(formValue.change_for) || undefined : undefined,
            pix_proof_url: pixProofUrl,
            items: this.cartService.items(),
            subtotal: this.cartService.subtotal(),
            delivery_fee: this.currentDeliveryFee(),
            total: this.total(),
            scheduled_time: formValue.scheduled_time || undefined,
            coupon_code: this.appliedCoupon()?.code,
            discount_amount: this.discountAmount(),
            shipping_discount_amount: this.shippingDiscount(),
            loyalty_discount_amount: this.appliedLoyaltyDiscount(),
            loyalty_shipping_discount_amount: this.loyaltyShippingDiscount(),
        };

        const newOrder = await this.dataService.addOrder(order);

        const coupon = this.appliedCoupon();
        if (coupon) this.authService.useCoupon(coupon.code);
        if (this.appliedLoyaltyDiscount() > 0 || this.appliedLoyaltyFreeShipping()) {
            this.authService.redeemLoyaltyPoints(this.settings());
        }
        this.authService.addLoyaltyPoints(order.subtotal, this.settings());
        
        const message = this.generateWhatsAppMessage(newOrder);
        this.openWhatsApp(message);
        
        this.cartService.clearCart();
        this.closeCheckout();
        this.removeCoupon();
        this.removeLoyaltyReward();
        this.componentCoupons.set([]); // Clear temporary coupons
        
        this.setTrackedOrderId(newOrder.id);
        this.isTrackingModalOpen.set(true);
        if (this.isBrowser()) {
          const orderHistoryJson = localStorage.getItem('acai_order_history');
          const orderHistory = orderHistoryJson ? JSON.parse(orderHistoryJson) : [];
          orderHistory.push(newOrder.id);
          localStorage.setItem('acai_order_history', JSON.stringify(orderHistory));
        }

    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      alert('Ocorreu um erro ao finalizar o pedido. ' + message);
    } finally {
      this.isSubmittingOrder.set(false);
    }
  }

  private generateWhatsAppMessage(order: Order): string {
    const settings = this.settings();
    let message = `*NOVO PEDIDO DO CARDÁPIO DIGITAL* 🎉\n\n`;
    message += `*Pedido #${order.id.slice(-4).toUpperCase()}*\n`;
    if (order.scheduled_time) {
      message += `*⚠️ PEDIDO AGENDADO PARA ${order.scheduled_time} ⚠️*\n\n`;
    }
    message += `*Cliente:* ${order.customer_name}\n\n`;

    order.items.forEach(item => {
        message += `*${item.quantity}x ${item.product_name}*`;
        if (item.size.name !== 'Único') {
            message += ` (${item.size.name})`;
        }
        message += ` - ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.total_price / item.quantity)}\n`;

        if (item.addons.length > 0) {
            const grouped = this.getGroupedAddons(item);
            grouped.forEach(g => {
                message += `  *_${g.categoryName}:_*\n`;
                g.addons.forEach(addon => {
                    message += `    - ${addon.name}`;
                    if(addon.price > 0) message += ` (+${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(addon.price)})`
                    message += '\n';
                })
            })
        }
        if (item.notes) {
            message += `  *Obs:* ${item.notes}\n`;
        }
    });

    message += `\n*Subtotal:* ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(order.subtotal)}\n`;

    if (order.delivery_fee > 0) {
        message += `*Taxa de Entrega:* ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(order.delivery_fee)}\n`;
    }

    if (order.discount_amount && order.discount_amount > 0) {
        message += `*Desconto:* -${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(order.discount_amount)}\n`;
    }
    if (order.shipping_discount_amount && order.shipping_discount_amount > 0) {
        message += `*Desconto Frete:* -${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(order.shipping_discount_amount)}\n`;
    }
     if (order.loyalty_discount_amount && order.loyalty_discount_amount > 0) {
        message += `*Desconto Fidelidade:* -${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(order.loyalty_discount_amount)}\n`;
    }
      if (order.loyalty_shipping_discount_amount && order.loyalty_shipping_discount_amount > 0) {
        message += `*Frete Grátis Fidelidade:* -${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(order.loyalty_shipping_discount_amount)}\n`;
    }

    message += `*Total:* *${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(order.total)}*\n\n`;

    if (order.delivery_option === 'delivery') {
        message += `*ENTREGA:* ${order.delivery_address}, ${order.neighborhood}\n\n`;
    } else {
        message += `*RETIRADA NA LOJA*\n\n`;
    }

    message += `*Pagamento:* ${this.paymentMethodNames[order.payment_method] || order.payment_method}\n`;
    if (order.payment_method === 'cash' && order.change_for) {
        message += `*Troco para:* ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(order.change_for)}\n`;
    }

    return message;
  }

  private openWhatsApp(message: string): void {
    const whatsappNumber = this.settings().whatsapp.replace(/\D/g, '');
    const url = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  }
}
