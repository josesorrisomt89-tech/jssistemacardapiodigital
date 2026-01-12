import { Injectable, signal, effect, inject } from '@angular/core';
import { firstValueFrom, forkJoin, map } from 'rxjs';
import { ShopSettings, Category, Product, AddonCategory, Order, DayOpeningHours, Coupon, Receivable, Expense, DeliveryDriver, DriverPayment, OrderStatus, Addon } from '../models';
import { ApiService } from './supabase.service'; // Agora importa o ApiService

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private apiService = inject(ApiService);

  settings = signal<ShopSettings>(this.getDefaultSettings());
  categories = signal<Category[]>([]);
  products = signal<Product[]>([]);
  addonCategories = signal<AddonCategory[]>([]);
  orders = signal<Order[]>([]);
  coupons = signal<Coupon[]>([]);
  receivables = signal<Receivable[]>([]);
  expenses = signal<Expense[]>([]);
  deliveryDrivers = signal<DeliveryDriver[]>([]);
  currentDriver = signal<DeliveryDriver | null>(null);
  driverPayments = signal<DriverPayment[]>([]);
  
  loadingStatus = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  loadingError = signal<string|null>(null);
  
  constructor() {
    effect(() => this.saveToLocalStorage('acai_current_driver', this.currentDriver()));
  }

  public load(): void {
    this.loadingStatus.set('loading');
    this.currentDriver.set(this.loadFromLocalStorage('acai_current_driver', null));
    this.initializeData();
  }

  private initializeData() {
    const requests = {
      settings: this.apiService.get<ShopSettings>('settings', 'limit=1'),
      categories: this.apiService.get<Category>('categories'),
      products: this.apiService.get<Product>('products'),
      addonCategories: this.apiService.get<AddonCategory>('addon_categories'),
      orders: this.apiService.get<Order>('orders'),
      coupons: this.apiService.get<Coupon>('coupons'),
      receivables: this.apiService.get<Receivable>('receivables'),
      expenses: this.apiService.get<Expense>('expenses'),
      deliveryDrivers: this.apiService.get<DeliveryDriver>('delivery_drivers'),
      driverPayments: this.apiService.get<DriverPayment>('driver_payments'),
    };

    forkJoin(requests).subscribe({
      next: (responses) => {
        const settingsRes = responses.settings[0];
        if (settingsRes) {
          const defaults = this.getDefaultSettings();
          const mergedSettings: ShopSettings = { ...defaults, ...settingsRes,
            opening_hours: { ...defaults.opening_hours, ...(settingsRes.opening_hours || {}) },
            delivery: { ...defaults.delivery, ...(settingsRes.delivery || {}) },
            layout: { ...defaults.layout, ...(settingsRes.layout || {}) },
            loyalty_program: { ...defaults.loyalty_program, ...(settingsRes.loyalty_program || {}) },
            slider_images: settingsRes.slider_images || [],
          };
          this.settings.set(mergedSettings);
        } else {
          this.settings.set(this.getDefaultSettings());
        }

        this.categories.set(responses.categories);
        this.products.set(responses.products);
        this.addonCategories.set(responses.addonCategories);
        this.orders.set(responses.orders);
        this.coupons.set(responses.coupons);
        this.receivables.set(responses.receivables);
        this.expenses.set(responses.expenses);
        this.deliveryDrivers.set(responses.deliveryDrivers);
        this.driverPayments.set(responses.driverPayments);

        this.loadingStatus.set('loaded');
      },
      error: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.loadingError.set(`Falha ao carregar dados iniciais: ${message}`);
        console.error('Falha crítica ao carregar dados iniciais.', error);
        this.loadingStatus.set('error');
      }
    });
  }
  
  /**
   * NOTA: A funcionalidade de realtime foi removida para garantir estabilidade.
   * O painel de admin agora usa "polling" (verifica a cada 20s) para novos pedidos.
   */
  public async fetchTable(tableName: string) {
    try {
        const data = await firstValueFrom(this.apiService.get<any>(tableName));
        switch(tableName) {
            case 'settings': this.initializeData(); break;
            case 'categories': this.categories.set(data); break;
            case 'products': this.products.set(data); break;
            case 'addon_categories': this.addonCategories.set(data); break;
            case 'orders': this.orders.set(data); break;
            case 'coupons': this.coupons.set(data); break;
            case 'receivables': this.receivables.set(data); break;
            case 'expenses': this.expenses.set(data); break;
            case 'delivery_drivers': this.deliveryDrivers.set(data); break;
            case 'driver_payments': this.driverPayments.set(data); break;
        }
    } catch(error) {
        console.error(`Error fetching table ${tableName}:`, error);
    }
  }

  isShopOpen = (): { is_open: boolean, hoursToday: DayOpeningHours | null, is_temporarily_closed: boolean, message: string } => {
    const settings = this.settings();
    if (settings.is_temporarily_closed) { return { is_open: false, hoursToday: null, is_temporarily_closed: true, message: settings.temporary_closure_message || 'Estamos temporariamente fechados.' }; }
    const now = new Date();
    const dayIndex = now.getDay();
    const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dayIndex] as keyof ShopSettings['opening_hours'];
    if (!settings.opening_hours) { return { is_open: false, hoursToday: null, is_temporarily_closed: false, message: 'Horário de funcionamento não configurado.' }; }
    const hoursToday = settings.opening_hours[dayName];
    if (!hoursToday || !hoursToday.is_open || !hoursToday.start || !hoursToday.end || !hoursToday.start.includes(':') || !hoursToday.end.includes(':')) {
      return { is_open: false, hoursToday, is_temporarily_closed: false, message: '' };
    }
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = hoursToday.start.split(':').map(Number);
    const startTime = startH * 60 + startM;
    const [endH, endM] = hoursToday.end.split(':').map(Number);
    const endTime = endH * 60 + endM;
    return { is_open: currentTime >= startTime && currentTime < endTime, hoursToday, is_temporarily_closed: false, message: '' };
  }

  async addOrder(order: Omit<Order, 'id' | 'date' | 'status'>, creditDetails?: Omit<Receivable, 'id' | 'order_id' | 'amount' | 'status' | 'created_at'>): Promise<Order> {
    const isScheduled = !!(order as Order).scheduled_time;
    const newOrderId = new Date().getTime().toString();
    const newOrder: Order = { ...order, id: newOrderId, date: new Date().toISOString(), status: isScheduled ? 'Agendado' : 'Recebido', is_delivery_broadcasted: false };
    if (order.payment_method === 'credit' && creditDetails) {
        const newReceivable: Receivable = { ...creditDetails, id: `rec_${newOrderId}`, order_id: newOrderId, amount: order.total, status: 'pending', created_at: new Date().toISOString() };
        newOrder.receivable_id = newReceivable.id;
        await firstValueFrom(this.apiService.post('receivables', newReceivable));
    }
    const data = await firstValueFrom(this.apiService.post<Order>('orders', newOrder, 'return=representation'));
    this.orders.update(orders => [...orders, data[0]]);
    return data[0];
  }
  
  async saveSettings(settings: ShopSettings) {
    const data = await firstValueFrom(this.apiService.patch<ShopSettings>('settings', 'id=eq.1', settings));
    this.settings.set(data[0]);
    return data[0];
  }
  
  async saveProduct(product: Product) {
     const data = await firstValueFrom(this.apiService.upsert<Product>('products', product));
     await this.fetchTable('products'); return data[0];
  }
  
  async deleteProduct(id: string) { await firstValueFrom(this.apiService.delete('products', `id=eq.${id}`)); await this.fetchTable('products'); }
  
   async saveCategory(category: Category) {
     const data = await firstValueFrom(this.apiService.upsert<Category>('categories', category));
     await this.fetchTable('categories'); return data[0];
  }
  
  async deleteCategory(id: string) { await firstValueFrom(this.apiService.delete('categories', `id=eq.${id}`)); await this.fetchTable('categories'); }

  async saveAddonCategory(addonCategory: AddonCategory) {
     const data = await firstValueFrom(this.apiService.upsert<AddonCategory>('addon_categories', addonCategory));
     await this.fetchTable('addon_categories'); return data[0];
  }
  
  async deleteAddonCategory(id: string) { await firstValueFrom(this.apiService.delete('addon_categories', `id=eq.${id}`)); await this.fetchTable('addon_categories'); }
  
  async saveCoupon(coupon: Coupon) {
     const data = await firstValueFrom(this.apiService.upsert<Coupon>('coupons', coupon));
     await this.fetchTable('coupons'); return data[0];
  }
  
  async deleteCoupon(id: string) { await firstValueFrom(this.apiService.delete('coupons', `id=eq.${id}`)); await this.fetchTable('coupons'); }

  async updateOrderStatus(orderId: string, status: OrderStatus, assignment?: { driverId: string | null, driverName: string | null, isBroadcast: boolean }) {
     let updateObject: Partial<Order> = { status };
     if (assignment) { Object.assign(updateObject, { assigned_driver_id: assignment.driverId, assigned_driver_name: assignment.driverName, is_delivery_broadcasted: assignment.isBroadcast }); }
     const data = await firstValueFrom(this.apiService.patch<Order>('orders', `id=eq.${orderId}`, updateObject));
     await this.fetchTable('orders'); return data[0];
  }

  async addExpense(expense: Omit<Expense, 'id'>): Promise<Expense> {
    const newExpense = { ...expense, id: Date.now().toString() };
    const data = await firstValueFrom(this.apiService.post<Expense>('expenses', newExpense, 'return=representation'));
    await this.fetchTable('expenses'); return data[0];
  }

  async updateExpense(updatedExpense: Expense): Promise<void> {
    await firstValueFrom(this.apiService.patch('expenses', `id=eq.${updatedExpense.id}`, updatedExpense));
    await this.fetchTable('expenses');
  }

  async deleteExpense(id: string): Promise<void> {
    await firstValueFrom(this.apiService.delete('expenses', `id=eq.${id}`));
    await this.fetchTable('expenses');
  }

  async updateReceivableStatus(id: string, status: 'pending' | 'paid'): Promise<void> {
    await firstValueFrom(this.apiService.patch('receivables', `id=eq.${id}`, { status }));
    await this.fetchTable('receivables');
  }
  
  async registerDriver(driverData: Omit<DeliveryDriver, 'id' | 'status'>): Promise<{ success: string } | { error: string }> {
    const existing = await firstValueFrom(this.apiService.get<DeliveryDriver>('delivery_drivers', `name=eq.${driverData.name}&limit=1`));
    if(existing.length > 0) return { error: 'Um entregador com este nome já existe.' };
    
    await firstValueFrom(this.apiService.post('delivery_drivers', { ...driverData, id: Date.now().toString(), status: 'pending' }));
    await this.fetchTable('delivery_drivers');
    return { success: 'Cadastro enviado para análise.' };
  }

  loginDriver(name: string, password?: string): DeliveryDriver | { error: string } {
    const driver = this.deliveryDrivers().find(d => d.name.toLowerCase() === name.toLowerCase());
    if (!driver) return { error: 'Entregador não encontrado.' };
    if (driver.password && driver.password !== password) return { error: 'Senha incorreta.' };
    if (driver.status !== 'approved') return { error: `Sua conta está com status: ${driver.status}.` };
    this.currentDriver.set(driver);
    return driver;
  }

  logoutDriver() { this.currentDriver.set(null); }
  
  async updateDriverStatus(driverId: string, status: DeliveryDriver['status']) {
    await firstValueFrom(this.apiService.patch('delivery_drivers', `id=eq.${driverId}`, { status }));
    await this.fetchTable('delivery_drivers');
  }

  async deleteDriver(driverId: string) {
    await firstValueFrom(this.apiService.delete('delivery_drivers', `id=eq.${driverId}`));
    await this.fetchTable('delivery_drivers');
  }
  
  async addDriverPayment(payment: Omit<DriverPayment, 'id'>) {
    const newPayment = { ...payment, id: Date.now().toString() };
    const data = await firstValueFrom(this.apiService.post<DriverPayment>('driver_payments', newPayment, 'return=representation'));
    await this.fetchTable('driver_payments');
    return data[0];
  }
  
  private loadFromLocalStorage<T>(key: string, defaultValue: T): T {
    try { const item = localStorage.getItem(key); return item ? JSON.parse(item) : defaultValue; } catch (e) { return defaultValue; }
  }

  private saveToLocalStorage<T>(key: string, value: T): void {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.error(`Error saving to localStorage for key "${key}"`, e); }
  }

  private getDefaultSettings(): ShopSettings {
    const weekTemplate = { is_open: true, start: "14:00", end: "22:00" };
    return {
      name: "Açaí Point", logo_url: "", banner_url: "",
      slider_images: [], pdv_background_image_url: '',
      address: "Seu Endereço Aqui", whatsapp: "5500000000000", delivery_whatsapp: "", instagram: "https://instagram.com", facebook: "https://facebook.com",
      welcome_message: "Bem-vindo ao Açaí Point! O melhor açaí da cidade.", wait_time: "30-50 min",
      opening_hours: { monday: { ...weekTemplate }, tuesday: { ...weekTemplate }, wednesday: { ...weekTemplate }, thursday: { ...weekTemplate }, friday: { ...weekTemplate }, saturday: { ...weekTemplate }, sunday: { is_open: false, start: "14:00", end: "22:00" }, },
      delivery: { type: 'fixed', fixed_fee: 5.00, neighborhoods: [] }, pix_key: "seu-email-pix@dominio.com",
      layout: { primary_color: '#8B5CF6', accent_color: '#A78BFA', background_color: '#111827', text_color: '#FFFFFF', card_color: '#1F2937' },
      loyalty_program: { enabled: true, points_per_real: 1, points_for_reward: 100, reward_type: 'fixed', reward_value: 10 },
      is_temporarily_closed: false, temporary_closure_message: 'Estamos fechados para manutenção. Voltamos logo!',
      admin_username: 'admin', admin_password: 'admin'
    };
  }
}