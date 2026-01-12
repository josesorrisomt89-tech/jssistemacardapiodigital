import { Injectable, signal, effect, inject, Injector, runInInjectionContext } from '@angular/core';
import { ShopSettings, Category, Product, AddonCategory, Order, DayOpeningHours, Coupon, Receivable, Expense, DeliveryDriver, DriverPayment, OrderStatus, Addon } from '../models';
import { SupabaseService } from './supabase.service';
import { SupabaseClient } from '@supabase/supabase-js';

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private supabaseService = inject(SupabaseService);
  private injector = inject(Injector);
  private supabase!: SupabaseClient;

  settings = signal<ShopSettings>(this.getDefaultSettings());
  categories = signal<Category[]>([]);
  products = signal<Product[]>([]);
  addonCategories = signal<AddonCategory[]>([]);
  orders = signal<Order[]>([]);
  coupons = signal<Coupon[]>([]);
  receivables = signal<Receivable[]>([]);
  expenses = signal<Expense[]>([]);
  deliveryDrivers = signal<DeliveryDriver[]>([]);
  currentDriver = signal<DeliveryDriver | null>(null); // Inicialização pura, sem side-effects.
  driverPayments = signal<DriverPayment[]>([]);
  
  loadingStatus = signal<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  loadingError = signal<string|null>(null);
  private isInitialized = false;

  constructor() {
    // O construtor agora está vazio para prevenir qualquer problema durante a injeção de dependências.
  }

  public async load(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    this.isInitialized = true;
    this.loadingStatus.set('loading');

    // Carrega o estado do localStorage aqui, em um ponto seguro do ciclo de vida.
    this.currentDriver.set(this.loadFromLocalStorage('acai_current_driver', null));

    // O effect agora é criado de forma segura aqui, dentro do contexto de injeção.
    runInInjectionContext(this.injector, () => {
        effect(() => this.saveToLocalStorage('acai_current_driver', this.currentDriver()));
    });

    // Inicializa o Supabase de forma segura aqui.
    if (!this.supabaseService.init()) {
      console.error('Abortando carregamento de dados devido a erro de inicialização do Supabase.');
      this.loadingError.set(this.supabaseService.initializationError());
      this.loadingStatus.set('error');
      return;
    }
    this.supabase = this.supabaseService.supabase;
    
    try {
        await this.initializeData();
        this.listenToChanges();
        this.loadingStatus.set('loaded');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.loadingError.set(`Falha ao carregar dados iniciais: ${message}`);
        console.error('Falha crítica ao carregar dados iniciais.', error);
        this.loadingStatus.set('error');
    }
  }

  async initializeData() {
    try {
      const [ settingsRes, categoriesRes, productsRes, addonsRes, ordersRes, couponsRes, receivablesRes, expensesRes, driversRes, driverPaymentsRes ] = await Promise.all([
        this.supabase.from('settings').select('*').limit(1).maybeSingle(),
        this.supabase.from('categories').select('*'),
        this.supabase.from('products').select('*'),
        this.supabase.from('addon_categories').select('*'),
        this.supabase.from('orders').select('*'),
        this.supabase.from('coupons').select('*'),
        this.supabase.from('receivables').select('*'),
        this.supabase.from('expenses').select('*'),
        this.supabase.from('delivery_drivers').select('*'),
        this.supabase.from('driver_payments').select('*'),
      ]);

      if (settingsRes.data) {
        const defaults = this.getDefaultSettings();
        const mergedSettings: ShopSettings = {
          ...defaults,
          ...settingsRes.data,
          opening_hours: { ...defaults.opening_hours, ...(settingsRes.data.opening_hours || {}) },
          delivery: { ...defaults.delivery, ...(settingsRes.data.delivery || {}) },
          layout: { ...defaults.layout, ...(settingsRes.data.layout || {}) },
          loyalty_program: { ...defaults.loyalty_program, ...(settingsRes.data.loyalty_program || {}) },
          slider_images: settingsRes.data.slider_images || [],
        };
        this.settings.set(mergedSettings);
      }
      
      if (categoriesRes.data) this.categories.set(categoriesRes.data);
      if (productsRes.data) this.products.set(productsRes.data);
      if (addonsRes.data) this.addonCategories.set(addonsRes.data);
      if (ordersRes.data) this.orders.set(ordersRes.data);
      if (couponsRes.data) this.coupons.set(couponsRes.data);
      if (receivablesRes.data) this.receivables.set(receivablesRes.data);
      if (expensesRes.data) this.expenses.set(expensesRes.data);
      if (driversRes.data) this.deliveryDrivers.set(driversRes.data);
      if (driverPaymentsRes.data) this.driverPayments.set(driverPaymentsRes.data);
    } catch (error) { 
      console.error('Error initializing data from Supabase:', error); 
      throw error;
    }
  }
  
  private listenToChanges() {
    this.supabase
      .channel('public-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
        console.log('Realtime change received!', payload);
        switch(payload.table) {
          case 'orders': this.supabase.from('orders').select('*').then(({ data }) => data && this.orders.set(data)); break;
          case 'products': this.supabase.from('products').select('*').then(({ data }) => data && this.products.set(data)); break;
          case 'settings': this.initializeData(); break;
        }
      })
      .subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log('Successfully subscribed to Supabase realtime changes!');
        }
        if (status === 'CHANNEL_ERROR' || err) {
          console.error('Supabase realtime subscription error:', err);
        }
      });
  }

  isShopOpen = (): { is_open: boolean, hoursToday: DayOpeningHours | null, is_temporarily_closed: boolean, message: string } => {
    const settings = this.settings();
    if (settings.is_temporarily_closed) { return { is_open: false, hoursToday: null, is_temporarily_closed: true, message: settings.temporary_closure_message || 'Estamos temporariamente fechados.' }; }
    const now = new Date();
    const dayIndex = now.getDay();
    const dayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dayIndex] as keyof ShopSettings['opening_hours'];
    if (!settings.opening_hours) { return { is_open: false, hoursToday: null, is_temporarily_closed: false, message: 'Horário de funcionamento não configurado.' }; }
    const hoursToday = settings.opening_hours[dayName];
    if (!hoursToday || !hoursToday.is_open) { return { is_open: false, hoursToday, is_temporarily_closed: false, message: '' }; }
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
        await this.supabase.from('receivables').insert(newReceivable);
    }
    const { data, error } = await this.supabase.from('orders').insert(newOrder).select().single();
    if (error) { console.error("Error adding order:", error); throw error; }
    return data;
  }
  
  async saveSettings(settings: ShopSettings) {
    const { data, error } = await this.supabase.from('settings').upsert(settings).eq('id', 1).select().single();
    if (error) throw error;
    this.settings.set(data);
    return data;
  }
  
  async saveProduct(product: Product) {
     const { data, error } = await this.supabase.from('products').upsert(product).select().single();
     if(error) throw error; return data;
  }
  
  async deleteProduct(id: string) {
    const { error } = await this.supabase.from('products').delete().eq('id', id); if(error) throw error;
  }
  
   async saveCategory(category: Category) {
     const { data, error } = await this.supabase.from('categories').upsert(category).select().single(); if(error) throw error; return data;
  }
  
  async deleteCategory(id: string) {
    const { error } = await this.supabase.from('categories').delete().eq('id', id); if(error) throw error;
  }

  async saveAddonCategory(addonCategory: AddonCategory) {
     const { data, error } = await this.supabase.from('addon_categories').upsert(addonCategory).select().single(); if(error) throw error; return data;
  }
  
  async deleteAddonCategory(id: string) {
    const { error } = await this.supabase.from('addon_categories').delete().eq('id', id); if(error) throw error;
  }
  
  async saveCoupon(coupon: Coupon) {
     const { data, error } = await this.supabase.from('coupons').upsert(coupon).select().single(); if(error) throw error; return data;
  }
  
  async deleteCoupon(id: string) {
    const { error } = await this.supabase.from('coupons').delete().eq('id', id); if(error) throw error;
  }

  async updateOrderStatus(orderId: string, status: OrderStatus, assignment?: { driverId: string | null, driverName: string | null, isBroadcast: boolean }) {
     let updateObject: Partial<Order> = { status };
     if (assignment) { Object.assign(updateObject, assignment); }
     const { data, error } = await this.supabase.from('orders').update(updateObject).eq('id', orderId).select().single(); if(error) throw error; return data;
  }

  async addExpense(expense: Omit<Expense, 'id'>): Promise<Expense> {
    const { data, error } = await this.supabase.from('expenses').insert(expense).select().single(); if(error) throw error;
    this.expenses.update(e => [data, ...e]); return data;
  }

  async updateExpense(updatedExpense: Expense): Promise<void> {
    const { error } = await this.supabase.from('expenses').update(updatedExpense).eq('id', updatedExpense.id); if(error) throw error;
    this.expenses.update(e => e.map(exp => exp.id === updatedExpense.id ? updatedExpense : exp));
  }

  async deleteExpense(id: string): Promise<void> {
    const { error } = await this.supabase.from('expenses').delete().eq('id', id); if(error) throw error;
    this.expenses.update(e => e.filter(exp => exp.id !== id));
  }

  async updateReceivableStatus(id: string, status: 'pending' | 'paid'): Promise<void> {
    const { error } = await this.supabase.from('receivables').update({ status }).eq('id', id); if(error) throw error;
    this.receivables.update(r => r.map(rec => rec.id === id ? { ...rec, status } : rec));
  }
  
  async registerDriver(driverData: Omit<DeliveryDriver, 'id' | 'status'>): Promise<{ success: string } | { error: string }> {
    const { data: existing, error: findError } = await this.supabase.from('delivery_drivers').select('id').eq('name', driverData.name).maybeSingle();
    if(findError) return { error: findError.message }; if(existing) return { error: 'Um entregador com este nome já existe.' };
    const { error } = await this.supabase.from('delivery_drivers').insert({ ...driverData, status: 'pending' }); if(error) return { error: error.message };
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
    const { error } = await this.supabase.from('delivery_drivers').update({ status }).eq('id', driverId); if(error) throw error;
    this.deliveryDrivers.update(drivers => drivers.map(d => d.id === driverId ? { ...d, status } : d));
  }

  async deleteDriver(driverId: string) {
    const { error } = await this.supabase.from('delivery_drivers').delete().eq('id', driverId); if(error) throw error;
    this.deliveryDrivers.update(drivers => drivers.filter(d => d.id !== driverId));
  }
  
  async addDriverPayment(payment: Omit<DriverPayment, 'id'>) {
    const { data, error } = await this.supabase.from('driver_payments').insert(payment).select().single(); if(error) throw error;
    this.driverPayments.update(p => [data, ...p]); return data;
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