import { ChangeDetectionStrategy, Component, inject, signal, computed, effect, ViewChild, ElementRef } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, FormArray, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { DataService } from '../../services/data.service';
import { AuthService } from '../../services/auth.service';
import { ShopSettings, Category, Product, AddonCategory, ProductSize, Addon, Order, NeighborhoodFee, OrderStatus, Coupon, CartItem, Receivable, Expense, DeliveryDriver, DriverPayment } from '../../models';
import { LayoutPreviewComponent } from '../../components/layout-preview/layout-preview.component';
import { ReceiptComponent } from '../../components/receipt/receipt.component';

@Component({
  selector: 'app-admin',
  templateUrl: './admin.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, CurrencyPipe, DatePipe, LayoutPreviewComponent, ReceiptComponent]
})
export class AdminComponent {
  dataService: DataService = inject(DataService);
  authService: AuthService = inject(AuthService);
  fb: FormBuilder = inject(FormBuilder);
  router: Router = inject(Router);
  
  @ViewChild('newOrderSound') newOrderSound!: ElementRef<HTMLAudioElement>;
  isNewOrderNotificationActive = signal(false);
  private knownReceivedOrderIds = new Set<string>();

  isLoggedIn = this.authService.isAdminLoggedIn;
  loginForm = this.fb.group({
    username: ['', Validators.required],
    password: ['', Validators.required]
  });
  loginError = signal<string | null>(null);

  activeTab = signal<'orders' | 'pdv' | 'sales' | 'accounts' | 'products' | 'drivers' | 'settings' | 'layout' | 'coupons' | 'loyalty'>('orders');
  
  orderStatuses: OrderStatus[] = ['Agendado', 'Recebido', 'Em Preparo', 'Aguardando Retirada', 'Saiu para Entrega', 'Entregue', 'Cancelado'];
  weekDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  weekDayNames: {[key: string]: string} = {
    monday: 'Segunda-feira', tuesday: 'Terça-feira', wednesday: 'Quarta-feira',
    thursday: 'Quinta-feira', friday: 'Sexta-feira', saturday: 'Sábado', sunday: 'Domingo'
  };
  colorNames: { [key: string]: string } = {
    primary_color: 'Cor Principal',
    accent_color: 'Cor de Destaque',
    background_color: 'Cor de Fundo',
    text_color: 'Cor do Texto',
    card_color: 'Cor do Card'
  };

  mainSettingsForm: FormGroup;
  loyaltyForm: FormGroup;

  mockUsers = signal<{name: string, email: string, loyalty_points: number}[]>([
    { name: 'Cliente Teste', email: 'cliente@teste.com', loyalty_points: 50 },
    { name: 'Maria Souza', email: 'maria@exemplo.com', loyalty_points: 180 },
    { name: 'João Silva', email: 'joao@exemplo.com', loyalty_points: 75 },
    { name: 'Ana Pereira', email: 'ana@exemplo.com', loyalty_points: 210 },
    { name: 'Carlos Ferreira', email: 'carlos@exemplo.com', loyalty_points: 25 },
  ]);

  productForm = this.fb.group({
    id: [''],
    order: [0],
    name: ['', { validators: [Validators.required] }],
    description: [''],
    image_url: [''],
    category_id: ['', { validators: [Validators.required] }],
    price_type: ['sized'],
    price: [0],
    sizes: this.fb.array([]),
    addon_categories: [[] as string[]],
    is_available: [true]
  });

  categoryForm = this.fb.group({
    id: [''],
    order: [0],
    name: ['', { validators: [Validators.required] }]
  });

  addonCategoryForm = this.fb.group({
    id: [''],
    order: [0],
    name: ['', { validators: [Validators.required] }],
    required: [false],
    addons: this.fb.array([])
  });

  couponForm: FormGroup;

  editingProduct = signal<Product | null>(null);
  editingCategory = signal<Category | null>(null);
  editingAddonCategory = signal<AddonCategory | null>(null);
  editingCoupon = signal<Coupon | null>(null);

  isReceiptModalOpen = signal(false);
  orderToPrint = signal<Order | null>(null);
  receiptMode = signal<'print' | 'delivery' | 'pdv'>('print');
  
  isDriverModalOpen = signal(false);
  orderToAssign = signal<Order | null>(null);
  drivers = this.dataService.deliveryDrivers;
  pendingDrivers = computed(() => this.drivers().filter(d => d.status === 'pending'));
  approvedDrivers = computed(() => this.drivers().filter(d => d.status === 'approved'));
  declinedDrivers = computed(() => this.drivers().filter(d => d.status === 'declined'));
  blockedDrivers = computed(() => this.drivers().filter(d => d.status === 'blocked'));
  
  isConfirmModalOpen = signal(false);
  confirmAction = signal<{ type: 'approve' | 'decline' | 'block' | 'ban', driverId: string } | null>(null);
  confirmMessage = signal('');

  driverView = signal<'management' | 'reports'>('management');
  selectedDriverForReport = signal<DeliveryDriver | null>(null);
  driverPaymentForm: FormGroup;

  reportDeliveries = computed(() => {
    const driverId = this.selectedDriverForReport()?.id;
    if (!driverId) return [];
    return this.dataService.orders()
      .filter(o => o.assigned_driver_id === driverId && o.status === 'Entregue')
      .sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });

  reportPayments = computed(() => {
    const driverId = this.selectedDriverForReport()?.id;
    if (!driverId) return [];
    return this.dataService.driverPayments()
      .filter(p => p.driver_id === driverId)
      .sort((a,b) => new Date(b.payment_date).getTime() - new Date(a.date).getTime());
  });

  reportTotals = computed(() => {
    const totalFees = this.reportDeliveries().reduce((sum, order) => sum + order.delivery_fee, 0);
    const totalPaid = this.reportPayments().reduce((sum, payment) => sum + payment.amount, 0);
    const balance = totalFees - totalPaid;
    return { totalFees, totalPaid, balance };
  });

  sortedCategories = computed(() => this.dataService.categories().sort((a, b) => a.order - b.order));
  sortedProducts = computed(() => this.dataService.products().sort((a, b) => a.order - b.order));
  sortedAddonCategories = computed(() => this.dataService.addonCategories().sort((a, b) => a.order - b.order));
  sortedCoupons = computed(() => this.dataService.coupons());
  
  activeOrders = computed(() => this.dataService.orders().filter(o => o.status !== 'Entregue' && o.status !== 'Cancelado'));
  totalSales = computed(() => this.dataService.orders().reduce((sum, order) => order.status !== 'Cancelado' ? sum + order.total : sum, 0));

  scheduledOrders = computed(() => this.dataService.orders().filter(o => o.status === 'Agendado').sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
  receivedOrders = computed(() => this.dataService.orders().filter(o => o.status === 'Recebido').sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
  inPreparationOrders = computed(() => this.dataService.orders().filter(o => o.status === 'Em Preparo').sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
  awaitingPickupOrders = computed(() => this.dataService.orders().filter(o => o.status === 'Aguardando Retirada').sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
  outForDeliveryOrders = computed(() => this.dataService.orders().filter(o => o.status === 'Saiu para Entrega').sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()));

  kanbanColumns = [
    { title: 'Recebido', orders: this.receivedOrders },
    { title: 'Em Preparo', orders: this.inPreparationOrders },
    { title: 'Aguardando Retirada', orders: this.awaitingPickupOrders },
    { title: 'Saiu para Entrega', orders: this.outForDeliveryOrders },
  ];

  pdvState = signal<'selecting' | 'balcao' | 'delivery'>('selecting');
  pdvCart = signal<CartItem[]>([]);
  pdvSubtotal = computed(() => this.pdvCart().reduce((sum, item) => sum + item.total_price, 0));
  pdvDeliveryFee = signal(0);
  pdvTotal = computed(() => this.pdvSubtotal() + this.pdvDeliveryFee());
  pdvCheckoutForm: FormGroup;
  tempPdvCustomerPhone = signal<string|null>(null);

  isPdvProductModalOpen = signal(false);
  pdvSelectedProduct = signal<Product | null>(null);
  pdvSelectedSize = signal<ProductSize | null>(null);
  pdvSelectedAddons = signal<{[key: string]: Addon}>({});
  pdvProductQuantity = signal(1);

  expenseForm: FormGroup;
  editingExpense = signal<Expense | null>(null);
  sortedReceivables = computed(() => this.dataService.receivables().sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
  sortedExpenses = computed(() => this.dataService.expenses().sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
  
  constructor() {
    this.mainSettingsForm = this.fb.group({
      name: [''], logo_url: [''], banner_url: [''], slider_images: this.fb.array([]), pdv_background_image_url: [''], address: [''],
      whatsapp: [''], delivery_whatsapp: [''], instagram: [''], facebook: [''], pix_key: [''],
      welcome_message: [''], wait_time: [''],
      opening_hours: this.fb.group(
        this.weekDays.reduce((acc, day) => ({ ...acc, [day]: this.fb.group({ is_open: [true], start: [''], end: [''] }) }), {})
      ),
      delivery: this.fb.group({ type: ['fixed'], fixed_fee: [0], neighborhoods: this.fb.array([]) }),
      layout: this.fb.group({
        primary_color: [''], accent_color: [''], background_color: [''], text_color: [''], card_color: ['']
      }),
      is_temporarily_closed: [false],
      temporary_closure_message: [''],
      admin_username: [''],
      admin_password: ['']
    });

    this.loyaltyForm = this.fb.group({
      enabled: [true],
      points_per_real: [1, [Validators.required, Validators.min(0)]],
      points_for_reward: [100, [Validators.required, Validators.min(1)]],
      reward_type: ['fixed' as 'fixed' | 'free_shipping', Validators.required],
      reward_value: [10, [Validators.required, Validators.min(0)]]
    });
    
    this.pdvCheckoutForm = this.fb.group({
        customer_name: ['', Validators.required],
        phone: [''],
        payment_method: ['cash', Validators.required],
        change_for: [{value: '', disabled: true}],
        address: [''],
        payment_due_date: [''],
        street: [''],
        number: [''],
        complement: [''],
        reference: [''],
        neighborhood: [''],
    });

    this.expenseForm = this.fb.group({
        id: [null],
        description: ['', Validators.required],
        amount: [null, [Validators.required, Validators.min(0.01)]],
        date: [new Date().toISOString().split('T')[0], Validators.required],
        category: ['']
    });

    this.couponForm = this.fb.group({
      id: [''],
      code: ['', Validators.required],
      description: ['', Validators.required],
      discount_type: ['fixed' as 'fixed' | 'percentage' | 'free_shipping', Validators.required],
      discount_value: [0, [Validators.required, Validators.min(0)]],
      minimum_order_value: [0, [Validators.min(0)]]
    });

     this.driverPaymentForm = this.fb.group({
      amount: [null, [Validators.required, Validators.min(0.01)]],
      payment_date: [new Date().toISOString().split('T')[0], Validators.required],
      notes: [''],
    });
    
    effect(() => this.patchSettingsForm(this.dataService.settings()));

    this.productForm.get('price_type')?.valueChanges.subscribe(type => {
      const priceControl = this.productForm.get('price');
      const sizesControl = this.productForm.get('sizes');
      if (type === 'fixed') {
        priceControl?.setValidators([Validators.required, Validators.min(0.01)]);
        sizesControl?.clearValidators();
        this.productSizes.clear();
      } else { // 'sized'
        priceControl?.clearValidators();
        priceControl?.setValue(0);
        sizesControl?.setValidators([Validators.required, Validators.minLength(1)]);
        if (this.productSizes.length === 0) {
          this.addProductSize();
        }
      }
      priceControl?.updateValueAndValidity();
      sizesControl?.updateValueAndValidity();
    });
    this.productForm.get('sizes')?.setValidators([Validators.required, Validators.minLength(1)]);
    this.productForm.get('price')?.clearValidators();


    this.pdvCheckoutForm.get('payment_method')?.valueChanges.subscribe(value => {
        const creditControls = {
            address: this.pdvCheckoutForm.get('address'),
            payment_due_date: this.pdvCheckoutForm.get('payment_due_date')
        };
        const phoneControl = this.pdvCheckoutForm.get('phone'); 
        const changeForControl = this.pdvCheckoutForm.get('change_for');

        if (value === 'credit') {
            Object.values(creditControls).forEach(control => control?.setValidators(Validators.required));
            phoneControl?.setValidators(Validators.required);
        } else {
            Object.values(creditControls).forEach(control => control?.clearValidators());
            if(this.pdvState() !== 'delivery') {
              phoneControl?.clearValidators();
            }
        }
        
        if (value === 'cash') {
            changeForControl?.enable();
        } else {
            changeForControl?.disable();
            changeForControl?.reset();
        }

        Object.values(creditControls).forEach(control => control?.updateValueAndValidity());
        phoneControl?.updateValueAndValidity();
    });
    
    this.pdvCheckoutForm.get('neighborhood')?.valueChanges.subscribe(() => {
        if(this.pdvState() === 'delivery'){
            this.updatePdvDeliveryFee();
        }
    });

    this.couponForm.get('discount_type')?.valueChanges.subscribe(value => {
      const discountValueControl = this.couponForm.get('discount_value');
      if (value === 'free_shipping') {
        discountValueControl?.setValue(0);
        discountValueControl?.disable();
      } else {
        discountValueControl?.enable();
      }
    });

    this.loyaltyForm.get('reward_type')?.valueChanges.subscribe(value => {
      const rewardValueControl = this.loyaltyForm.get('reward_value');
      if (value === 'free_shipping') {
        rewardValueControl?.setValue(0);
        rewardValueControl?.disable();
      } else {
        rewardValueControl?.enable();
      }
    });

    effect(() => {
      const allOrders = this.dataService.orders();
      const currentReceivedOrders = allOrders.filter(o => o.status === 'Recebido');
      const currentReceivedIds = new Set<string>(currentReceivedOrders.map(o => o.id));

      let hasNewOrder = false;
      for (const id of currentReceivedIds) {
        if (!this.knownReceivedOrderIds.has(id)) {
          hasNewOrder = true;
          break;
        }
      }

      if (hasNewOrder) {
        this.isNewOrderNotificationActive.set(true);
        this.playNewOrderSound();
      } else if (currentReceivedOrders.length === 0 && this.isNewOrderNotificationActive()) {
        this.isNewOrderNotificationActive.set(false);
        this.stopNewOrderSound();
      }

      this.knownReceivedOrderIds = currentReceivedIds;
    });
  }

  playNewOrderSound() {
    this.newOrderSound?.nativeElement.play().catch(e => console.error("Audio playback failed:", e));
  }

  stopNewOrderSound() {
    if (this.newOrderSound) {
      this.newOrderSound.nativeElement.pause();
      this.newOrderSound.nativeElement.currentTime = 0;
    }
  }

  get productSizes() { return this.productForm.get('sizes') as FormArray; }
  get addonCategoryAddons() { return this.addonCategoryForm.get('addons') as FormArray; }
  get deliveryNeighborhoods() { return this.mainSettingsForm.get('delivery.neighborhoods') as FormArray; }
  get openingHoursControls() { return (this.mainSettingsForm.get('opening_hours') as FormGroup).controls; }
  get sliderImages() { return this.mainSettingsForm.get('slider_images') as FormArray; }

  handleLogin() {
    this.loginError.set(null);
    if (this.loginForm.invalid) {
        return;
    }
    const { username, password } = this.loginForm.getRawValue();
    const { error } = this.authService.adminLogin(username!, password!);
    if (error) {
        this.loginError.set(error);
    } else {
        this.loginForm.reset();
    }
  }
  
  logout() {
    this.authService.adminLogout();
  }

  onFileChange(event: Event, formControlName: string, formGroup: FormGroup = this.mainSettingsForm) {
    const reader = new FileReader();
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length) {
      const file = input.files[0];
      reader.readAsDataURL(file);
      reader.onload = () => {
        formGroup.patchValue({ [formControlName]: reader.result as string });
      };
    }
  }

  onSliderFileChange(event: Event, index: number) {
    const reader = new FileReader();
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length) {
      const file = input.files[0];
      reader.readAsDataURL(file);
      reader.onload = () => {
        this.sliderImages.at(index).setValue(reader.result as string);
      };
    }
  }

  patchSettingsForm(settings: ShopSettings) {
    this.mainSettingsForm.patchValue(settings);
    this.mainSettingsForm.get('admin_password')?.reset('');
    if(settings.loyalty_program) this.loyaltyForm.patchValue(settings.loyalty_program);
    
    this.deliveryNeighborhoods.clear();
    settings.delivery?.neighborhoods?.forEach(hood => this.addNeighborhood(hood));
    
    this.sliderImages.clear();
    settings.slider_images?.forEach(image => this.addSliderImage(image));
  }
  
  async saveMainSettings() {
    if (this.mainSettingsForm.invalid) {
      alert('Por favor, corrija os erros no formulário antes de salvar.');
      return;
    }
    const formValue = this.mainSettingsForm.getRawValue();
    const currentSettings = this.dataService.settings();

    if (!formValue.admin_password || formValue.admin_password.trim() === '') {
        formValue.admin_password = currentSettings.admin_password;
    }
    
    // Create a new object to send to Supabase, to avoid potential readonly issues with signals.
    const settingsToSave = { ...currentSettings, ...formValue };
    // The settings table should only have one row, with a fixed ID.
    const settingsWithId: ShopSettings = { ...settingsToSave, id: 1 };


    await this.dataService.saveSettings(settingsWithId);
    alert('Configurações salvas!');
    this.mainSettingsForm.get('admin_password')?.reset('');
  }

  async toggleTemporaryClosure() {
    const currentSettings = this.dataService.settings();
    const isNowClosed = !currentSettings.is_temporarily_closed;
    const settingsToSave: ShopSettings = { ...currentSettings, is_temporarily_closed: isNowClosed, id: 1 };
    await this.dataService.saveSettings(settingsToSave);
  }

  async saveLoyaltySettings() {
    if (this.loyaltyForm.invalid) {
      alert('Por favor, corrija os erros no formulário de fidelidade antes de salvar.');
      return;
    }
    const currentSettings = this.dataService.settings();
    const settingsToSave: ShopSettings = { ...currentSettings, loyalty_program: this.loyaltyForm.getRawValue(), id: 1 };
    await this.dataService.saveSettings(settingsToSave);
    alert('Configurações de fidelidade salvas!');
  }

  addNeighborhood(hood?: NeighborhoodFee) { this.deliveryNeighborhoods.push(this.fb.group({ name: [hood?.name || ''], fee: [hood?.fee || 0] })); }
  removeNeighborhood(index: number) { this.deliveryNeighborhoods.removeAt(index); }
  addSliderImage(imageUrl?: string) { this.sliderImages.push(this.fb.control(imageUrl || '')); }
  removeSliderImage(index: number) { this.sliderImages.removeAt(index); }
  
  async moveItem<T extends { order: number, id: string }>(listName: 'categories' | 'products' | 'addonCategories', index: number, direction: 'up' | 'down') {
    const listSignal = this.dataService[listName] as signal<(T)[]>;
    const list = [...listSignal()].sort((a,b) => a.order - b.order);
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= list.length) return;
    
    [list[index], list[newIndex]] = [list[newIndex], list[index]];
    
    const updates = list.map(async (item, idx) => {
        const updatedItem = { ...item, order: idx };
        if (listName === 'categories') await this.dataService.saveCategory(updatedItem as any);
        if (listName === 'products') await this.dataService.saveProduct(updatedItem as any);
        if (listName === 'addonCategories') await this.dataService.saveAddonCategory(updatedItem as any);
        return updatedItem;
    });
    
    const updatedList = await Promise.all(updates);
    listSignal.set(updatedList);
  }

  editProduct(product: Product | null) {
    this.productForm.reset({ addon_categories: [], is_available: true, price_type: 'sized' });
    this.productSizes.clear();
    if (product) {
      this.editingProduct.set(product);
      const productData = { ...product, price_type: product.price_type || (product.sizes && product.sizes.length > 0 ? 'sized' : 'fixed') };
      this.productForm.patchValue(productData);
      if (productData.price_type === 'sized') {
          product.sizes.forEach(size => this.addProductSize(size));
      }
    } else {
        this.editingProduct.set({} as Product);
        this.addProductSize();
    }
  }
  
  addProductSize(size?: ProductSize) { this.productSizes.push(this.fb.group({ name: [size?.name || '', Validators.required], price: [size?.price || 0, Validators.required], is_available: [size?.is_available ?? true] })); }
  removeProductSize(index: number) { this.productSizes.removeAt(index); }
  
  async saveProduct() {
    if (this.productForm.invalid) { alert('Por favor, preencha todos os campos obrigatórios do produto.'); return; }
    
    const formData = this.productForm.getRawValue();
    if (formData.price_type === 'fixed') formData.sizes = []; else formData.price = 0;
    
    if (!formData.id) {
      formData.id = Date.now().toString();
      formData.order = this.dataService.products().length;
    }

    try {
      await this.dataService.saveProduct(formData as Product);
      this.editingProduct.set(null);
    } catch (error) {
      console.error('Failed to save product:', error);
      alert('Falha ao salvar o produto.');
    }
  }

  async deleteProduct(id: string) { if(confirm('Tem certeza?')) { await this.dataService.deleteProduct(id); } }

  editCategory(category: Category | null) {
      if (category) {
        this.editingCategory.set(category);
        this.categoryForm.patchValue(category);
      } else {
        this.editingCategory.set({} as Category);
        this.categoryForm.reset();
      }
  }

  async saveCategory() {
      if (this.categoryForm.invalid) { alert('O nome da categoria é obrigatório.'); return; }
      const formData = this.categoryForm.value;
      if (!formData.id) {
        formData.id = Date.now().toString();
        formData.order = this.dataService.categories().length;
      }
      await this.dataService.saveCategory(formData as Category);
      this.editingCategory.set(null);
  }

  async deleteCategory(id: string) { if(confirm('Tem certeza?')) { await this.dataService.deleteCategory(id); } }
  
  editAddonCategory(ac: AddonCategory | null) {
      this.addonCategoryForm.reset({required: false, addon_categories: []});
      this.addonCategoryAddons.clear();
      if (ac) {
          this.editingAddonCategory.set(ac);
          this.addonCategoryForm.patchValue(ac);
          ac.addons.sort((a,b) => a.order - b.order).forEach(addon => this.addAddonToAddonCategory(addon));
      } else {
          this.editingAddonCategory.set({} as AddonCategory);
          this.addAddonToAddonCategory();
      }
  }
  
  addAddonToAddonCategory(addon?: Addon) { this.addonCategoryAddons.push(this.fb.group({ id: [addon?.id || Date.now().toString()], name: [addon?.name || '', Validators.required], price: [addon?.price || 0], order: [addon?.order || 0], is_available: [addon?.is_available ?? true] })); }
  removeAddonFromAddonCategory(index: number) { this.addonCategoryAddons.removeAt(index); }
  
  async saveAddonCategory() {
      if (this.addonCategoryForm.invalid) { alert('Preencha todos os campos da categoria de adicionais.'); return; }
      const formData = this.addonCategoryForm.value;
      formData.addons?.forEach((addon, index) => addon.order = index);

      if (!formData.id) {
          formData.id = Date.now().toString();
          formData.order = this.dataService.addonCategories().length;
      }
      await this.dataService.saveAddonCategory(formData as AddonCategory);
      this.editingAddonCategory.set(null);
  }

  async deleteAddonCategory(id: string) { if(confirm('Tem certeza?')) { await this.dataService.deleteAddonCategory(id); } }

  editCoupon(coupon: Coupon | null) {
    this.couponForm.get('discount_value')?.enable();
    if (coupon) {
      this.editingCoupon.set(coupon);
      this.couponForm.patchValue(coupon);
    } else {
      this.editingCoupon.set({} as Coupon);
      this.couponForm.reset({ discount_type: 'fixed', discount_value: 0, minimum_order_value: 0 });
    }
  }

  async saveCoupon() {
    if (this.couponForm.invalid) { alert('Preencha os campos do cupom.'); return; }
    
    const formData = this.couponForm.getRawValue();
    if (!formData.id) formData.id = Date.now().toString();
    
    await this.dataService.saveCoupon(formData as Coupon);
    this.editingCoupon.set(null);
  }

  async deleteCoupon(id: string) { if (confirm('Tem certeza?')) { await this.dataService.deleteCoupon(id); } }

  async updateOrderStatus(orderId: string, event: Event) {
    const status = (event.target as HTMLSelectElement).value as OrderStatus;
    await this.dataService.updateOrderStatus(orderId, status);
  }

  openDriverAssignmentModal(order: Order) {
    this.orderToAssign.set(order);
    this.isDriverModalOpen.set(true);
  }

  async assignOrder(driverId: string | 'all') {
    const order = this.orderToAssign();
    if (!order) return;

    let driver: DeliveryDriver | undefined;
    if (driverId !== 'all') {
      driver = this.approvedDrivers().find(d => d.id === driverId);
    }
    
    await this.dataService.updateOrderStatus(order.id, order.status, {
      driverId: driver ? driver.id : null,
      driverName: driver ? driver.name : null,
      isBroadcast: true
    });

    this.isDriverModalOpen.set(false);
    this.orderToAssign.set(null);
  }

  async cancelDelivery(orderId: string) {
    const order = this.dataService.orders().find(o => o.id === orderId);
    if (!order) return;
    await this.dataService.updateOrderStatus(orderId, order.status, { driverId: null, driverName: null, isBroadcast: false });
  }
  
  sendDeliveryMessage(order: Order) {
    let message = `*ENTREGA PENDENTE* - Pedido #${order.id.slice(-4)}\n\n*Cliente:* ${order.customer_name}\n*Endereço:* ${order.delivery_address}\n*Bairro:* ${order.neighborhood}\n\n*Total:* ${new CurrencyPipe('pt-BR').transform(order.total, 'BRL', 'symbol', '1.2-2')}\n*Pagamento:* ${order.payment_method}`;
    if(order.payment_method === 'cash') { message += ` (Levar troco para ${new CurrencyPipe('pt-BR').transform(order.change_for, 'BRL', 'symbol', '1.2-2')})` }
    const settings = this.dataService.settings();
    const deliveryWhatsappNumber = settings.delivery_whatsapp || settings.whatsapp;
    window.open(`https://wa.me/${deliveryWhatsappNumber}?text=${encodeURIComponent(message)}`, '_blank');
  }

  openReceiptModal(order: Order, mode: 'print' | 'delivery' | 'pdv' = 'print') {
    this.receiptMode.set(mode);
    this.orderToPrint.set(order);
    this.isReceiptModalOpen.set(true);
  }

  handleDeliveryConfirmation() {
    const order = this.orderToPrint();
    if (order) this.sendDeliveryMessage(order);
    this.isReceiptModalOpen.set(false);
    this.orderToPrint.set(null);
  }

  isAddonCategorySelected(id: string): boolean {
    const selectedIds = this.productForm.get('addon_categories')?.value as string[] || [];
    return selectedIds.includes(id);
  }

  onAddonCategoryChange(event: Event, id: string) {
    const control = this.productForm.get('addon_categories');
    if (!control) return;
    const selectedIds = [...(control.value as string[] || [])];
    const input = event.target as HTMLInputElement;
    if (input.checked) {
      if (!selectedIds.includes(id)) selectedIds.push(id);
    } else {
      const index = selectedIds.indexOf(id);
      if (index > -1) selectedIds.splice(index, 1);
    }
    control.setValue(selectedIds);
  }

  getCategoryName(id: string): string { return this.dataService.categories().find(c => c.id === id)?.name || 'Sem Categoria'; }
  getAddonCategoryById(id: string): AddonCategory | undefined { return this.dataService.addonCategories().find(ac => ac.id === id); }
  getAddonNames(addons: Addon[]): string { return addons.map(a => a.name).join(', '); }

  startPdvOrder(type: 'balcao' | 'delivery') {
    this.pdvState.set(type);
    const form = this.pdvCheckoutForm;
    form.reset({ payment_method: 'cash' });
    this.pdvCheckoutForm.get('change_for')?.enable();
    const deliveryControls = ['street', 'number', 'neighborhood', 'phone'];
    if (type === 'delivery') deliveryControls.forEach(name => form.get(name)?.setValidators(Validators.required));
    else deliveryControls.forEach(name => form.get(name)?.clearValidators());
    deliveryControls.forEach(name => form.get(name)?.updateValueAndValidity());
  }

  cancelPdvOrder() {
    this.pdvCart.set([]);
    this.pdvCheckoutForm.reset();
    this.pdvDeliveryFee.set(0);
    this.pdvState.set('selecting');
  }
  
  updatePdvDeliveryFee() {
    const deliverySettings = this.dataService.settings().delivery;
    if (this.pdvState() !== 'delivery') { this.pdvDeliveryFee.set(0); return; }
    if (deliverySettings.type === 'fixed') this.pdvDeliveryFee.set(deliverySettings.fixed_fee);
    else {
      const hoodName = this.pdvCheckoutForm.get('neighborhood')?.value;
      const hood = deliverySettings.neighborhoods.find(h => h.name === hoodName);
      this.pdvDeliveryFee.set(hood ? hood.fee : 0);
    }
  }

  openPdvProductModal(product: Product) {
    if (!product.is_available) return;
    this.pdvSelectedProduct.set(product);
    const priceType = product.price_type || 'sized';
    if (priceType === 'sized' && product.sizes.length > 0) {
      this.pdvSelectedSize.set(product.sizes.find(s => s.is_available) ?? null);
    } else {
      this.pdvSelectedSize.set(null);
    }
    this.pdvProductQuantity.set(1);
    this.pdvSelectedAddons.set({});
    this.isPdvProductModalOpen.set(true);
  }

  closePdvProductModal() { this.isPdvProductModalOpen.set(false); }
  incrementPdvQuantity() { this.pdvProductQuantity.update(q => q + 1); }
  decrementPdvQuantity() { this.pdvProductQuantity.update(q => q > 1 ? q - 1 : 1); }
  
  togglePdvAddon(addon: Addon) {
    if(!addon.is_available) return;
    const currentAddons = {...this.pdvSelectedAddons()};
    if (currentAddons[addon.id]) delete currentAddons[addon.id];
    else currentAddons[addon.id] = addon;
    this.pdvSelectedAddons.set(currentAddons);
  }

  addProductToPdvCartFromModal() {
    const product = this.pdvSelectedProduct(); if (!product) return;
    let size: ProductSize;
    const priceType = product.price_type || 'sized';
    if (priceType === 'fixed') { size = { name: 'Único', price: product.price ?? 0, is_available: true }; }
    else { const selected = this.pdvSelectedSize(); if (!selected) { alert('Selecione um tamanho.'); return; } size = selected; }
    const addons: Addon[] = Object.values(this.pdvSelectedAddons());
    const quantity = this.pdvProductQuantity();
    const totalPrice = (size.price + addons.reduce((sum, addon) => sum + addon.price, 0)) * quantity;
    const newItem: CartItem = { product_id: product.id, product_name: product.name, size, addons, quantity, total_price: totalPrice };
    this.pdvCart.update(items => [...items, newItem]);
    this.closePdvProductModal();
  }

  removePdvCartItem(index: number) { this.pdvCart.update(items => items.filter((_, i) => i !== index)); }
  incrementPdvCartItem(index: number) { this.pdvCart.update(items => { const item = items[index]; const unitPrice = item.total_price / item.quantity; item.quantity++; item.total_price = unitPrice * item.quantity; return [...items]; }); }
  decrementPdvCartItem(index: number) { this.pdvCart.update(items => { const item = items[index]; if(item.quantity > 1) { const unitPrice = item.total_price / item.quantity; item.quantity--; item.total_price = unitPrice * item.quantity; } return [...items]; }); }
  
  private getComposedAddress(formValue: any): string {
    const { street, number, complement, reference } = formValue;
    return [`${street || ''}, ${number || ''}`, complement, reference ? `(Ref: ${reference})` : ''].filter(p => p).join(' - ');
  }

  async finalizePdvOrder() {
    this.pdvCheckoutForm.markAllAsTouched();
    if(this.pdvCart().length === 0) { alert('O carrinho está vazio.'); return; }
    if(this.pdvCheckoutForm.invalid) { alert('Preencha todos os campos obrigatórios.'); return; }
    const formValue = this.pdvCheckoutForm.getRawValue();
    const baseOrder: Omit<Order, 'id' | 'date' | 'status' | 'delivery_option'> = { customer_name: formValue.customer_name, payment_method: formValue.payment_method, change_for: formValue.payment_method === 'cash' ? Number(formValue.change_for) || undefined : undefined, items: this.pdvCart(), subtotal: this.pdvSubtotal(), total: this.pdvTotal(), delivery_fee: this.pdvDeliveryFee(), };
    if (this.pdvState() === 'balcao') {
        const newOrder = await this.dataService.addOrder({ ...baseOrder, delivery_option: 'counter' });
        await this.dataService.updateOrderStatus(newOrder.id, 'Entregue');
        this.tempPdvCustomerPhone.set(formValue.phone || null);
        this.openReceiptModal(newOrder, 'pdv');
    } else if (this.pdvState() === 'delivery') {
        await this.dataService.addOrder({ ...baseOrder, delivery_option: 'delivery', delivery_address: this.getComposedAddress(formValue), neighborhood: formValue.neighborhood });
        alert('Pedido de delivery criado!');
        this.cancelPdvOrder();
        this.activeTab.set('orders');
    }
  }

  handleSendReceipt(order: Order) {
    const phone = this.tempPdvCustomerPhone(); if (!phone) { alert('Telefone não informado.'); return; }
    let message = `Olá ${order.customer_name}, obrigado pela sua compra!\n\n*Resumo do Pedido #${order.id.slice(-4)}*\n\n`;
    order.items.forEach(item => { message += `*${item.quantity}x ${item.product_name} (${item.size.name})*\n`; });
    message += `\n*TOTAL:* *${new CurrencyPipe('pt-BR').transform(order.total, 'BRL', 'symbol', '1.2-2')}*\n\nAgradecemos a preferência!`;
    window.open(`https://wa.me/55${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`, '_blank');
  }

  handleReceiptClose() {
    this.isReceiptModalOpen.set(false);
    this.orderToPrint.set(null);
    this.tempPdvCustomerPhone.set(null);
    this.cancelPdvOrder();
  }

  async saveExpense() {
    this.expenseForm.markAllAsTouched(); if(this.expenseForm.invalid) return;
    const formValue = this.expenseForm.value;
    if(formValue.id) await this.dataService.updateExpense(formValue);
    else await this.dataService.addExpense(formValue);
    this.cancelEditExpense();
  }

  editExpense(expense: Expense) { this.editingExpense.set(expense); this.expenseForm.patchValue(expense); }
  cancelEditExpense() { this.editingExpense.set(null); this.expenseForm.reset({ date: new Date().toISOString().split('T')[0] }); }
  async deleteExpense(id: string) { if(confirm('Tem certeza?')) await this.dataService.deleteExpense(id); }
  async markReceivableAsPaid(id: string) { if(confirm('Marcar como paga?')) await this.dataService.updateReceivableStatus(id, 'paid'); }
  
  async approveDriver(driverId: string) { await this.dataService.updateDriverStatus(driverId, 'approved'); this.closeConfirmModal(); }
  async declineDriver(driverId: string) { await this.dataService.updateDriverStatus(driverId, 'declined'); this.closeConfirmModal(); }
  async blockDriver(driverId: string) { await this.dataService.updateDriverStatus(driverId, 'blocked'); this.closeConfirmModal(); }
  async unblockDriver(driverId: string) { await this.dataService.updateDriverStatus(driverId, 'approved'); }
  async banDriver(driverId: string) { await this.dataService.deleteDriver(driverId); this.closeConfirmModal(); }
  
  openConfirmModal(type: 'approve' | 'decline' | 'block' | 'ban', driverId: string, message: string) {
    this.confirmMessage.set(message);
    this.confirmAction.set({ type, driverId });
    this.isConfirmModalOpen.set(true);
  }
  
  async handleConfirm() {
    const action = this.confirmAction(); if (!action) return;
    if (action.type === 'approve') await this.approveDriver(action.driverId);
    if (action.type === 'decline') await this.declineDriver(action.driverId);
    if (action.type === 'block') await this.blockDriver(action.driverId);
    if (action.type === 'ban') await this.banDriver(action.driverId);
  }

  closeConfirmModal() { this.isConfirmModalOpen.set(false); this.confirmAction.set(null); this.confirmMessage.set(''); }

  selectDriverForReport(event: Event) {
    const driverId = (event.target as HTMLSelectElement).value;
    this.selectedDriverForReport.set(this.approvedDrivers().find(d => d.id === driverId) || null);
  }

  async saveDriverPayment() {
    this.driverPaymentForm.markAllAsTouched();
    const driver = this.selectedDriverForReport();
    if (this.driverPaymentForm.invalid || !driver) return;
    const paymentData = this.driverPaymentForm.value;
    await this.dataService.addDriverPayment({ driver_id: driver.id, driver_name: driver.name, amount: paymentData.amount, payment_date: paymentData.payment_date, notes: paymentData.notes || undefined });
    this.driverPaymentForm.reset({ payment_date: new Date().toISOString().split('T')[0] });
  }
}