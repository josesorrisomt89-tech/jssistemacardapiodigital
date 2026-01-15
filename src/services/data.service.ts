import { Injectable, signal, effect, inject } from '@angular/core';
import { firstValueFrom, forkJoin, map } from 'rxjs';
import { ShopSettings, Category, Product, AddonCategory, Order, DayOpeningHours, Coupon, Receivable, Expense, DeliveryDriver, DriverPayment, OrderStatus, Addon } from '../models';
import { ApiService } from './supabase.service';
import { ImageUploadService } from './image-upload.service';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private apiService = inject(ApiService);
  private imageUploadService = inject(ImageUploadService);

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

  private generateUUID(): string {
    // Gerador de UUID v4 para compatibilidade com o banco de dados.
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
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

        // Extract selection rules embedded in the addons jsonb field
        this.addonCategories.update(categories => {
          return categories.map(cat => {
            const rules = cat.addons?.find((a: any) => a.__selection_rules__);
            const cleanAddons = cat.addons?.filter((a: any) => !a.__selection_rules__) || [];
            return {
              ...cat,
              addons: cleanAddons,
              min_selection: (rules as any)?.min ?? 0,
              max_selection: (rules as any)?.max ?? 0
            };
          });
        });

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
    const newOrderId = this.generateUUID();
    const newOrder: Order = { ...order, id: newOrderId, date: new Date().toISOString(), status: isScheduled ? 'Agendado' : 'Recebido', is_delivery_broadcasted: false };
    if (order.payment_method === 'credit' && creditDetails) {
        const newReceivable: Receivable = { ...creditDetails, id: this.generateUUID(), order_id: newOrderId, amount: order.total, status: 'pending', created_at: new Date().toISOString() };
        newOrder.receivable_id = newReceivable.id;
        await firstValueFrom(this.apiService.post('receivables', [newReceivable]));
    }
    const data = await firstValueFrom(this.apiService.post<Order>('orders', [newOrder], 'return=representation'));
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
     this.products.update(items => {
        const index = items.findIndex(i => i.id === data[0].id);
        if(index > -1) { items[index] = data[0]; return [...items]; }
        return [...items, data[0]];
    });
     return data[0];
  }
  
  async deleteProduct(id: string) {
    const productToDelete = this.products().find(p => p.id === id);
    if (productToDelete && productToDelete.image_url) {
        await this.imageUploadService.deleteImage(productToDelete.image_url);
    }
    await firstValueFrom(this.apiService.delete('products', `id=eq.${id}`)); 
    this.products.update(items => items.filter(i => i.id !== id));
  }
  
   async saveCategory(category: Category) {
     const data = await firstValueFrom(this.apiService.upsert<Category>('categories', category));
     this.categories.update(items => {
        const index = items.findIndex(i => i.id === data[0].id);
        if(index > -1) { items[index] = data[0]; return [...items]; }
        return [...items, data[0]];
    });
     return data[0];
  }
  
  async deleteCategory(id: string) { 
    await firstValueFrom(this.apiService.delete('categories', `id=eq.${id}`));
    this.categories.update(items => items.filter(i => i.id !== id));
  }

  async saveAddonCategory(addonCategory: AddonCategory): Promise<AddonCategory> {
    const { min_selection, max_selection, ...categoryData } = addonCategory;

    const cleanAddons = categoryData.addons.filter((a: any) => !a.__selection_rules__);
    const addonsToSave = [...cleanAddons];
    if ((min_selection && min_selection > 0) || (max_selection && max_selection > 0)) {
      addonsToSave.push({
        __selection_rules__: true,
        min: min_selection || 0,
        max: max_selection || 0,
      } as any);
    }

    const categoryToSave = {
      ...categoryData,
      addons: addonsToSave,
    };

    const savedData = await firstValueFrom(this.apiService.upsert<any>('addon_categories', categoryToSave));
    const returnedCategory = savedData[0];

    const finalCategory: AddonCategory = {
      ...returnedCategory,
      addons: cleanAddons,
      min_selection: min_selection || 0,
      max_selection: max_selection || 0,
    };

    this.addonCategories.update(items => {
      const index = items.findIndex(i => i.id === finalCategory.id);
      if (index > -1) {
        items[index] = finalCategory;
        return [...items];
      }
      return [...items, finalCategory];
    });

    return finalCategory;
  }
  
  async deleteAddonCategory(id: string) { 
    await firstValueFrom(this.apiService.delete('addon_categories', `id=eq.${id}`));
    this.addonCategories.update(items => items.filter(i => i.id !== id));
  }
  
  async saveCoupon(coupon: Coupon) {
     const data = await firstValueFrom(this.apiService.upsert<Coupon>('coupons', coupon));
     this.coupons.update(items => {
        const index = items.findIndex(i => i.id === data[0].id);
        if(index > -1) { items[index] = data[0]; return [...items]; }
        return [...items, data[0]];
    });
     return data[0];
  }
  
  async deleteCoupon(id: string) { 
    await firstValueFrom(this.apiService.delete('coupons', `id=eq.${id}`));
    this.coupons.update(items => items.filter(i => i.id !== id));
  }

  async updateOrderStatus(orderId: string, status: OrderStatus, assignment?: { driverId: string | null, driverName: string | null, isBroadcast: boolean }) {
     let updateObject: Partial<Order> = { status };
     if (assignment) { Object.assign(updateObject, { assigned_driver_id: assignment.driverId, assigned_driver_name: assignment.driverName, is_delivery_broadcasted: assignment.isBroadcast }); }
     const data = await firstValueFrom(this.apiService.patch<Order>('orders', `id=eq.${orderId}`, updateObject));
     await this.fetchTable('orders'); return data[0];
  }

  async addExpense(expense: Omit<Expense, 'id'>): Promise<Expense> {
    const newExpense = { ...expense, id: this.generateUUID() };
    const data = await firstValueFrom(this.apiService.post<Expense>('expenses', [newExpense], 'return=representation'));
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
    
    await firstValueFrom(this.apiService.post('delivery_drivers', [{ ...driverData, id: this.generateUUID(), status: 'pending' }]));
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
    const newPayment = { ...payment, id: this.generateUUID() };
    const data = await firstValueFrom(this.apiService.post<DriverPayment>('driver_payments', [newPayment], 'return=representation'));
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
      name: "Açaí na Garrafa Rafinha", logo_url: "", banner_url: "",
      slider_images: [], pdv_background_image_url: '',
      address: "Av. Principal, 123, Centro", whatsapp: "5500000000000", delivery_whatsapp: "", instagram: "https://instagram.com", facebook: "https://facebook.com",
      welcome_message: "Bem-vindo! O melhor açaí da cidade, feito com carinho para você.", wait_time: "30-50 min",
      opening_hours: { monday: { ...weekTemplate }, tuesday: { ...weekTemplate }, wednesday: { ...weekTemplate }, thursday: { ...weekTemplate }, friday: { ...weekTemplate }, saturday: { ...weekTemplate }, sunday: { is_open: false, start: "14:00", end: "22:00" }, },
      delivery: { type: 'fixed', fixed_fee: 5.00, neighborhoods: [] }, pix_key: "seu-email-pix@dominio.com",
      layout: { 
        primary_color: '#7C3AED', 
        accent_color: '#FBBF24', 
        background_color: '#F9FAFB', 
        text_color: '#1F2937', 
        card_color: '#FFFFFF',
        button_text_color: '#FFFFFF',
        text_secondary_color: '#6B7280',
        status_open_color: '#10B981',
        status_closed_color: '#EF4444',
        header_text_color: '#FFFFFF',
        category_text_color: '#1F2937'
      },
      loyalty_program: { enabled: true, points_per_real: 1, points_for_reward: 100, reward_type: 'fixed', reward_value: 10 },
      is_temporarily_closed: false, temporary_closure_message: 'Estamos fechados para manutenção. Voltamos logo!',
      admin_username: 'admin', admin_password: 'admin'
    };
  }
}