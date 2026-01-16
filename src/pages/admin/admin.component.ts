import { ChangeDetectionStrategy, Component, inject, signal, computed, effect, ViewChild, ElementRef, OnInit, OnDestroy, Signal, WritableSignal } from '@angular/core';
import { CurrencyPipe, DatePipe, KeyValuePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, FormArray, FormGroup, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';
import { AuthService } from '../../services/auth.service';
import { ImageUploadService } from '../../services/image-upload.service';
import { ShopSettings, Category, Product, AddonCategory, ProductSize, Addon, Order, NeighborhoodFee, OrderStatus, Coupon, CartItem, Receivable, Expense, DeliveryDriver, DriverPayment } from '../../models';
import { LayoutPreviewComponent } from '../../components/layout-preview/layout-preview.component';
import { ReceiptComponent } from '../../components/receipt/receipt.component';
import { GeminiService } from '../../services/gemini.service';

@Component({
  selector: 'app-admin',
  templateUrl: './admin.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, CurrencyPipe, DatePipe, KeyValuePipe, LayoutPreviewComponent, ReceiptComponent, RouterLink]
})
export class AdminComponent implements OnInit, OnDestroy {
  private dataService: DataService = inject(DataService);
  private authService: AuthService = inject(AuthService);
  private fb: FormBuilder = inject(FormBuilder);
  private router: Router = inject(Router);
  private geminiService: GeminiService = inject(GeminiService);
  private imageUploadService: ImageUploadService = inject(ImageUploadService);
  
  @ViewChild('newOrderSound') newOrderSound!: ElementRef<HTMLAudioElement>;
  isNewOrderNotificationActive = signal(false);
  private knownReceivedOrderIds = new Set<string>();
  private orderPollingInterval: any;

  isLoggedIn = this.authService.isAdminLoggedIn;
  loginForm = this.fb.group({
    username: ['', Validators.required],
    password: ['', Validators.required]
  });
  loginError = signal<string | null>(null);

  activeTab = signal<'orders' | 'pdv' | 'sales' | 'accounts' | 'products' | 'drivers' | 'settings' | 'layout' | 'coupons' | 'loyalty' | 'help'>('orders');
  
  orderStatuses: OrderStatus[] = ['Agendado', 'Recebido', 'Em Preparo', 'Aguardando Retirada', 'Saiu para Entrega', 'Entregue', 'Pago e Entregue', 'Cancelado'];
  weekDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  weekDayNames: {[key: string]: string} = {
    monday: 'Segunda-feira', tuesday: 'Terça-feira', wednesday: 'Quarta-feira',
    thursday: 'Quinta-feira', friday: 'Sexta-feira', saturday: 'Sábado', sunday: 'Domingo'
  };
  colorNames: { [key: string]: string } = {
    primary_color: 'Cor Principal',
    accent_color: 'Cor de Destaque',
    background_color: 'Cor de Fundo',
    text_color: 'Cor do Texto Principal',
    card_color: 'Cor do Card',
    button_text_color: 'Cor do Texto do Botão',
    text_secondary_color: 'Cor do Texto Secundário',
    status_open_color: 'Cor Status (Aberto)',
    status_closed_color: 'Cor Status (Fechado)',
    header_text_color: 'Cor do Título no Banner',
    category_text_color: 'Cor do Título da Categoria'
  };

  paymentMethodNames: { [key: string]: string } = {
    'pix-machine': 'PIX Maquininha',
    'card': 'Cartão',
    'cash': 'Dinheiro',
    'pix-online': 'PIX Online',
    'credit': 'Fiado',
    'delivery': 'Delivery',
    'pickup': 'Retirada',
    'counter': 'Balcão'
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

  addonCategoryForm: FormGroup;

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

  isGeneratingDescription = signal(false);
  isGeneratingImage = signal(false);
  isUploading = signal(false);
  
  private productFile = signal<File | null>(null);

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
      .sort((a,b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime());
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
  
  activeOrders = computed(() => this.dataService.orders().filter(o => o.status !== 'Pago e Entregue' && o.status !== 'Cancelado'));
  
  // Sales Tab Filters & Data
  salesFilterStartDate = signal<string>('');
  salesFilterEndDate = signal<string>('');
  salesFilterType = signal<string>('');
  salesFilterStatus = signal<string>('');
  salesFilterPaymentMethod = signal<string>('');

  uniqueSalesFilterOptions = computed(() => {
    const allOrders = this.dataService.orders();
    const types = new Set(allOrders.map(o => o.delivery_option));
    const statuses = new Set(allOrders.map(o => o.status));
    const payments = new Set(allOrders.map(o => o.payment_method));
    return {
      types: Array.from(types),
      statuses: Array.from(statuses),
      payments: Array.from(payments)
    };
  });

  filteredSalesOrders = computed(() => {
    const orders = this.dataService.orders();
    const startDate = this.salesFilterStartDate();
    const endDate = this.salesFilterEndDate();
    const type = this.salesFilterType();
    const status = this.salesFilterStatus();
    const payment = this.salesFilterPaymentMethod();

    return orders.filter(o => {
      const orderDate = new Date(o.date);
      if (startDate && new Date(startDate) > orderDate) return false;
      if (endDate && new Date(endDate).setHours(23,59,59,999) < orderDate.getTime()) return false;
      if (type && o.delivery_option !== type) return false;
      if (status && o.status !== status) return false;
      if (payment && o.payment_method !== payment) return false;
      return true;
    }).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  });
  
  salesDashboardStats = computed(() => {
    const filteredOrders = this.filteredSalesOrders().filter(o => o.status !== 'Cancelado');
    const totalRevenue = filteredOrders.reduce((sum, order) => sum + order.total, 0);
    const orderCount = filteredOrders.length;
    const avgTicket = orderCount > 0 ? totalRevenue / orderCount : 0;
    
    const revenueByPayment = filteredOrders.reduce((acc, order) => {
      acc[order.payment_method] = (acc[order.payment_method] || 0) + order.total;
      return acc;
    }, {} as {[key: string]: number});

    const revenueByType = filteredOrders.reduce((acc, order) => {
      acc[order.delivery_option] = (acc[order.delivery_option] || 0) + order.total;
      return acc;
    }, {} as {[key: string]: number});

    return { totalRevenue, orderCount, avgTicket, revenueByPayment, revenueByType };
  });
  
  filteredTotalSales = computed(() => this.filteredSalesOrders().reduce((sum, order) => order.status !== 'Cancelado' ? sum + order.total : sum, 0));

  scheduledOrders = computed(() => this.dataService.orders().filter(o => o.status === 'Agendado').sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
  receivedOrders = computed(() => this.dataService.orders().filter(o => o.status === 'Recebido').sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
  inPreparationOrders = computed(() => this.dataService.orders().filter(o => o.status === 'Em Preparo').sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
  awaitingPickupOrders = computed(() => this.dataService.orders().filter(o => o.status === 'Aguardando Retirada').sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
  outForDeliveryOrders = computed(() => this.dataService.orders().filter(o => o.status === 'Saiu para Entrega').sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()));
  deliveredOrders = computed(() => this.dataService.orders().filter(o => o.status === 'Entregue').sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()));

  kanbanColumns = [
    { title: 'Recebido', orders: this.receivedOrders },
    { title: 'Em Preparo', orders: this.inPreparationOrders },
    { title: 'Aguardando Retirada', orders: this.awaitingPickupOrders },
    { title: 'Saiu para Entrega', orders: this.outForDeliveryOrders },
    { title: 'Entregue', orders: this.deliveredOrders },
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
  pdvProductNotes = signal('');

  isPdvAddToCartDisabled = computed(() => {
    const product = this.pdvSelectedProduct();
    if (!product) return true;
    const priceType = product.price_type || (product.sizes && product.sizes.length > 0 ? 'sized' : 'fixed');
    if (priceType === 'sized') {
      return !this.pdvSelectedSize();
    }
    return false;
  });

  expenseForm: FormGroup;
  editingExpense = signal<Expense | null>(null);
  sortedReceivables = computed(() => this.dataService.receivables().sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()));
  sortedExpenses = computed(() => this.dataService.expenses().sort((a,b) => new Date(b.date).getTime() - new Date(b.date).getTime()));
  
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
        primary_color: [''], 
        accent_color: [''], 
        background_color: [''], 
        text_color: [''], 
        card_color: [''],
        button_text_color: [''],
        text_secondary_color: [''],
        status_open_color: [''],
        status_closed_color: [''],
        header_text_color: [''],
        category_text_color: ['']
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

    this.addonCategoryForm = this.fb.group({
      id: [''],
      order: [0],
      name: ['', { validators: [Validators.required] }],
      required: [false],
      min_selection: [0, [Validators.min(0)]],
      max_selection: [0, [Validators.min(0)]],
      addons: this.fb.array([])
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

  ngOnInit(): void {
    // Inicia o polling para verificar novos pedidos a cada 20 segundos
    this.orderPollingInterval = setInterval(() => {
      console.log('Verificando novos pedidos...');
      this.dataService.fetchTable('orders');
    }, 20000);
  }

  ngOnDestroy(): void {
    // Limpa o intervalo quando o componente é destruído para evitar vazamentos de memória
    if (this.orderPollingInterval) {
      clearInterval(this.orderPollingInterval);
    }
    this.stopNewOrderSound();
  }

  private generateUUID(): string {
    // Gerador de UUID v4 para compatibilidade com o banco de dados.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
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
    const settings = this.dataService.settings();
    const { error } = this.authService.adminLogin(username!, password!, settings);
    if (error) {
        this.loginError.set(error);
    } else {
        this.loginForm.reset();
    }
  }
  
  logout() {
    this.authService.adminLogout();
  }

  async onFileChange(event: Event, formControlName: string) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];

    this.isUploading.set(true);
    try {
        const currentUrl = this.mainSettingsForm.get(formControlName)?.value;
        const newUrl = await this.imageUploadService.uploadImage(file, formControlName, currentUrl);
        this.mainSettingsForm.get(formControlName)?.setValue(newUrl);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Upload failed:', error);
        alert(`Falha no upload da imagem. ${message}`);
    } finally {
        this.isUploading.set(false);
    }
  }

  async onProductFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    this.productFile.set(input.files[0]);
    
    // Show preview
    const reader = new FileReader();
    reader.onload = (e) => this.productForm.get('image_url')?.setValue(e.target?.result as string);
    reader.readAsDataURL(this.productFile()!);
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
    this.isUploading.set(true);
    try {
      const formValue = this.mainSettingsForm.getRawValue();
      const currentSettings = this.dataService.settings();

      if (!formValue.admin_password || formValue.admin_password.trim() === '') {
          formValue.admin_password = currentSettings.admin_password;
      }
      
      const settingsToSave: ShopSettings = { ...currentSettings, ...formValue, id: 1 };
      await this.dataService.saveSettings(settingsToSave);
      alert('Configurações salvas!');
      this.mainSettingsForm.get('admin_password')?.reset('');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Error saving settings:', error);
      alert(`Falha ao salvar configurações. ${message}`);
    } finally {
      this.isUploading.set(false);
    }
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
  
  sortNeighborhoods() {
    const neighborhoodsArray = this.deliveryNeighborhoods;
    const currentValues = neighborhoodsArray.value as NeighborhoodFee[];
  
    if (!currentValues || currentValues.length < 2) {
      return;
    }
  
    const sortedValues = [...currentValues].sort((a, b) =>
      (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' })
    );
  
    // Limpa o FormArray preservando a referência
    neighborhoodsArray.clear();
  
    // Repopula o FormArray com os novos FormGroups na ordem correta
    sortedValues.forEach(hood => {
      neighborhoodsArray.push(this.fb.group({
        name: hood.name || '',
        fee: hood.fee || 0
      }));
    });
  }

  addSliderImage(image: string = '') { this.sliderImages.push(this.fb.control(image)); }
  async removeSliderImage(index: number) {
    const urlToRemove = this.sliderImages.at(index).value;
    if (urlToRemove) {
      this.isUploading.set(true);
      await this.imageUploadService.deleteImage(urlToRemove);
      this.isUploading.set(false);
    }
    this.sliderImages.removeAt(index);
  }
  async onSliderFileChange(event: Event, index: number) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    this.isUploading.set(true);
    try {
      const currentUrl = this.sliderImages.at(index).value;
      const newUrl = await this.imageUploadService.uploadImage(file, `slider/${Date.now()}`, currentUrl);
      this.sliderImages.at(index).setValue(newUrl);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      alert(`Falha no upload da imagem do slider. ${message}`);
    } finally {
      this.isUploading.set(false);
    }
  }
  
  async moveItem(listName: 'categories' | 'products' | 'addonCategories', index: number, direction: 'up' | 'down') {
    // This is verbose, but it's completely type-safe and avoids generics or `any` casts
    // that can cause issues with the Angular compiler in this specific environment.
    if (listName === 'categories') {
        const list = [...this.dataService.categories()].sort((a, b) => a.order - b.order);
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= list.length) return;

        [list[index], list[newIndex]] = [list[newIndex], list[index]];
        
        const updatedList = list.map((item, idx) => ({ ...item, order: idx }));
        this.dataService.categories.set(updatedList); // Optimistic update
        
        // Backend update
        const updates = updatedList.map(item => this.dataService.saveCategory(item));
        await Promise.all(updates).catch(async (err) => {
            console.error('Error saving category order, reverting.', err);
            await this.dataService.fetchTable('categories'); // Revert on error
        });

    } else if (listName === 'products') {
        const list = [...this.dataService.products()].sort((a, b) => a.order - b.order);
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= list.length) return;

        [list[index], list[newIndex]] = [list[newIndex], list[index]];

        const updatedList = list.map((item, idx) => ({ ...item, order: idx }));
        this.dataService.products.set(updatedList); // Optimistic update

        const updates = updatedList.map(item => this.dataService.saveProduct(item));
        await Promise.all(updates).catch(async (err) => {
            console.error('Error saving product order, reverting.', err);
            await this.dataService.fetchTable('products');
        });

    } else if (listName === 'addonCategories') {
        const list = [...this.dataService.addonCategories()].sort((a, b) => a.order - b.order);
        const newIndex = direction === 'up' ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= list.length) return;
        
        [list[index], list[newIndex]] = [list[newIndex], list[index]];

        const updatedList = list.map((item, idx) => ({ ...item, order: idx }));
        this.dataService.addonCategories.set(updatedList); // Optimistic update
        
        const updates = updatedList.map(item => this.dataService.saveAddonCategory(item));
        await Promise.all(updates).catch(async (err) => {
            console.error('Error saving addon category order, reverting.', err);
            await this.dataService.fetchTable('addonCategories');
        });
    }
  }

  private getUniqueSizes(sizes: ProductSize[]): ProductSize[] {
    if (!sizes) return [];
    const uniqueMap = new Map<string, ProductSize>();
    sizes.forEach(size => {
      // 1. Validate that the size object and its name are valid strings
      // 2. Filter out entries where the name is empty or only contains whitespace
      if (size && typeof size.name === 'string' && size.name.trim() !== '') {
        const trimmedName = size.name.trim();
        const key = `${trimmedName.toLowerCase()}|${size.price}`;
        
        // 3. Add to map only if it's a unique combination of name and price
        if (!uniqueMap.has(key)) {
          // 4. Store the size object with the name trimmed to remove leading/trailing spaces
          uniqueMap.set(key, { ...size, name: trimmedName });
        }
      }
    });
    return Array.from(uniqueMap.values());
  }

  editProduct(product: Product | null) {
    this.productFile.set(null);
    this.productForm.reset({ is_available: true, price_type: 'sized', addon_categories: [] });
    this.productSizes.clear();

    if (product) {
      this.editingProduct.set(product);
      
      const { sizes, ...productDataForPatch } = product;

      const productData = { 
        ...productDataForPatch, 
        price_type: product.price_type || (product.sizes && product.sizes.length > 0 ? 'sized' : 'fixed') 
      };
      
      this.productForm.patchValue(productData);

      if (productData.price_type === 'sized' && product.sizes) {
          const cleanSizes = this.getUniqueSizes(product.sizes);
          cleanSizes.forEach(size => this.addProductSize(size));
      }
    } else {
        this.editingProduct.set({} as Product);
        this.addProductSize();
    }
  }
  
  addProductSize(size?: ProductSize) { 
    this.productSizes.push(this.fb.group({ 
        name: [size?.name || '', Validators.required], 
        price: [size?.price || 0], 
        is_available: [size?.is_available ?? true] 
    })); 
  }
  removeProductSize(index: number) { this.productSizes.removeAt(index); }
  
  async saveProduct() {
    // Definitve Fix: Clean the form array itself before validation and saving.
    const sizesArray = this.productForm.get('sizes') as FormArray;
    if (this.productForm.get('price_type')?.value === 'sized' && sizesArray) {
      for (let i = sizesArray.length - 1; i >= 0; i--) {
        const sizeGroup = sizesArray.at(i);
        const nameControl = sizeGroup.get('name');
        if (!nameControl?.value || nameControl.value.trim() === '') {
          sizesArray.removeAt(i);
        }
      }
    }
    
    if (this.productForm.invalid) {
      alert('Por favor, preencha todos os campos obrigatórios.');
      return;
    }
    
    this.isUploading.set(true);
    try {
      const formData = this.productForm.getRawValue();
      const currentProduct = this.editingProduct();

      if (this.productFile()) {
        const pathPrefix = `products/${formData.id || this.generateUUID()}`;
        const newUrl = await this.imageUploadService.uploadImage(this.productFile()!, pathPrefix, currentProduct?.image_url);
        (formData as any).image_url = newUrl;
      }
      
      if (formData.price_type === 'fixed') {
        (formData as any).sizes = [];
      } else {
        (formData as any).price = 0;
      }
      
      if (!formData.id) {
        (formData as any).id = this.generateUUID();
        (formData as any).order = this.dataService.products().length;
      }
      
      await this.dataService.saveProduct(formData as Product);
      this.editingProduct.set(null);
      this.productFile.set(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Failed to save product:', error);
      alert(`Falha ao salvar o produto. ${message}`);
    } finally {
      this.isUploading.set(false);
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
      try {
        const formData = this.categoryForm.getRawValue();
        if (!formData.id) {
          (formData as any).id = this.generateUUID();
          (formData as any).order = this.dataService.categories().length;
        }
        await this.dataService.saveCategory(formData as Category);
        this.editingCategory.set(null);
      } catch(e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("Error saving category:", e);
        alert(`Falha ao salvar categoria. ${message}`);
      }
  }

  async deleteCategory(id: string) { if(confirm('Tem certeza?')) { await this.dataService.deleteCategory(id); } }
  
  editAddonCategory(ac: AddonCategory | null) {
      this.addonCategoryForm.reset({required: false, min_selection: 0, max_selection: 0});
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
  
  addAddonToAddonCategory(addon?: Addon) {
    this.addonCategoryAddons.push(this.fb.group({
      id: [addon?.id || this.generateUUID()],
      name: [addon?.name || '', Validators.required],
      price: [addon?.price || 0],
      order: [addon?.order || 0],
      is_available: [addon?.is_available ?? true]
    }));
  }
  removeAddonFromAddonCategory(index: number) { this.addonCategoryAddons.removeAt(index); }
  
  async saveAddonCategory() {
      if (this.addonCategoryForm.invalid) { alert('Preencha todos os campos da categoria de adicionais.'); return; }
      try {
        const formData = this.addonCategoryForm.getRawValue();
        (formData.addons as any[])?.forEach((addon: any, index: number) => addon.order = index);

        if (!formData.id) {
            (formData as any).id = this.generateUUID();
            (formData as any).order = this.dataService.addonCategories().length;
        }
        await this.dataService.saveAddonCategory(formData as AddonCategory);
        this.editingAddonCategory.set(null);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        console.error("Error saving addon category:", e);
        alert(`Falha ao salvar o grupo de adicionais. ${message}`);
      }
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
    try {
      const formData = this.couponForm.getRawValue();
      if (!formData.id) (formData as any).id = this.generateUUID();
      
      await this.dataService.saveCoupon(formData as Coupon);
      this.editingCoupon.set(null);
    } catch(e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("Error saving coupon:", e);
      alert(`Falha ao salvar o cupom. ${message}`);
    }
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
    if (order.payment_method === 'cash') {
      message += ` (Levar troco para ${new CurrencyPipe('pt-BR').transform(order.change_for, 'BRL', 'symbol', '1.2-2')})`;
    }
    const settings = this.dataService.settings();
    const deliveryWhatsappNumber = settings.delivery_whatsapp || settings.whatsapp;
    const sanitizedNumber = deliveryWhatsappNumber.replace(/\D/g, '');
    const whatsappUrl = `https://wa.me/${sanitizedNumber}?text=${encodeURIComponent(message)}`;
    window.location.href = whatsappUrl;
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
    this.pdvSelectedSize.set(null);
    this.pdvProductQuantity.set(1);
    this.pdvSelectedAddons.set({});
    this.pdvProductNotes.set('');
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
    const priceType = product.price_type || (product.sizes && product.sizes.length > 0 ? 'sized' : 'fixed');
    if (priceType === 'fixed') { size = { name: 'Único', price: product.price ?? 0, is_available: true }; }
    else { const selected = this.pdvSelectedSize(); if (!selected) { alert('Selecione um tamanho.'); return; } size = selected; }
    const addons: Addon[] = Object.values(this.pdvSelectedAddons());
    const quantity = this.pdvProductQuantity();
    const totalPrice = (size.price + addons.reduce((sum, addon) => sum + addon.price, 0)) * quantity;
    const newItem: CartItem = { product_id: product.id, product_name: product.name, size, addons, quantity, total_price: totalPrice, notes: this.pdvProductNotes() || undefined };
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
    const baseOrder: Omit<Order, 'id' | 'date' | 'status' | 'delivery_option'> = { customer_name: formValue.customer_name, payment_method: formValue.payment_method as any, change_for: formValue.payment_method === 'cash' ? Number(formValue.change_for) || undefined : undefined, items: this.pdvCart(), subtotal: this.pdvSubtotal(), total: this.pdvTotal(), delivery_fee: this.pdvDeliveryFee(), };
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
    const phone = this.tempPdvCustomerPhone();
    if (!phone) {
      alert('Telefone não informado.');
      return;
    }
    let message = `Olá ${order.customer_name}, obrigado pela sua compra!\n\n*Resumo do Pedido #${order.id.slice(-4)}*\n\n`;
    order.items.forEach(item => {
      message += `*${item.quantity}x ${item.product_name} (${item.size.name})*\n`;
    });
    message += `\n*TOTAL:* *${new CurrencyPipe('pt-BR').transform(order.total, 'BRL', 'symbol', '1.2-2')}*\n\nAgradecemos a preferência!`;
    const whatsappUrl = `https://wa.me/55${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;
    window.location.href = whatsappUrl;
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

  async generateDescription() {
    const productName = this.productForm.get('name')?.value;
    if (!productName) {
      alert('Por favor, insira um nome para o produto primeiro.');
      return;
    }
    this.isGeneratingDescription.set(true);
    try {
      const description = await this.geminiService.generateDescription(productName);
      this.productForm.get('description')?.setValue(description);
    } catch (error) {
      console.error(error);
      alert('Ocorreu um erro ao gerar a descrição.');
    } finally {
      this.isGeneratingDescription.set(false);
    }
  }

  async generateImage() {
    const productName = this.productForm.get('name')?.value;
    const productDescription = this.productForm.get('description')?.value;
    if (!productName) {
      alert('Por favor, insira um nome para o produto primeiro.');
      return;
    }
    this.isGeneratingImage.set(true);
    try {
      const base64Image = await this.geminiService.generateImage(productName, productDescription || 'Um delicioso item do nosso cardápio');
      if (base64Image) {
        const file = this.imageUploadService.base64ToFile(base64Image, `${productName.replace(/\s/g, '_')}.jpg`);
        this.productFile.set(file);
        this.productForm.get('image_url')?.setValue(base64Image);
      } else {
        alert('Não foi possível gerar a imagem. Tente novamente.');
      }
    } catch (error) {
      console.error(error);
      alert('Ocorreu um erro ao gerar a imagem.');
    } finally {
      this.isGeneratingImage.set(false);
    }
  }
  
  printHelpGuide(): void {
    window.print();
  }
}
