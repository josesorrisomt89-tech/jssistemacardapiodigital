import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, ViewChild, ElementRef } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { DataService } from '../../services/data.service';
import { Order, OrderStatus, DeliveryDriver } from '../../models';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-delivery',
  templateUrl: './delivery.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, DatePipe, RouterLink, ReactiveFormsModule],
})
export class DeliveryComponent {
  dataService: DataService = inject(DataService);
  router: Router = inject(Router);
  fb: FormBuilder = inject(FormBuilder);
  
  @ViewChild('newDeliverySound') newDeliverySound!: ElementRef<HTMLAudioElement>;
  newDeliveryAvailable = signal(false);
  private knownAvailableOrderIds = new Set<string>();

  settings = this.dataService.settings;
  currentDriver = this.dataService.currentDriver;

  activeView = signal<'login' | 'register' | 'pending'>('login');
  activeTab = signal<'orders' | 'stats'>('orders');
  
  loginForm = this.fb.group({
    name: ['', Validators.required],
    password: [''],
  });
  loginError = signal<string | null>(null);

  registerForm = this.fb.group({
    name: ['', Validators.required],
    whatsapp: ['', Validators.required],
    address: ['', Validators.required],
    cnh: ['', Validators.required],
    password: ['', Validators.required],
  });
  registerError = signal<string | null>(null);

  constructor() {
    effect(() => {
      const driver = this.currentDriver();
      if (!driver) {
        this.newDeliveryAvailable.set(false);
        this.knownAvailableOrderIds = new Set();
        return;
      }

      const currentAvailableOrders = this.deliveryOrders().filter(o => !o.assigned_driver_id);
      const currentIds = new Set<string>(currentAvailableOrders.map(o => o.id));

      let hasNewOrder = false;
      for (const id of currentIds) {
          if (!this.knownAvailableOrderIds.has(id)) {
              hasNewOrder = true;
              break;
          }
      }

      if (hasNewOrder) {
          this.playNewDeliverySound();
          this.newDeliveryAvailable.set(true);
      }
      
      this.knownAvailableOrderIds = currentIds;
    });
  }

  playNewDeliverySound() {
    this.newDeliverySound?.nativeElement.play().catch(e => console.error("Audio playback failed:", e));
  }

  deliveryOrders = computed(() => {
    const driver = this.currentDriver();
    if (!driver) return [];

    return this.dataService.orders()
      .filter(o => o.delivery_option === 'delivery' && (
          (o.is_delivery_broadcasted && (o.status === 'Em Preparo' || o.status === 'Aguardando Retirada') && o.assigned_driver_id === null) || 
          (o.assigned_driver_id === driver.id && ['Em Preparo', 'Aguardando Retirada', 'Saiu para Entrega'].includes(o.status))
      ))
      .sort((a, b) => {
        const statusPriority = (order: Order) => {
          if (order.status === 'Aguardando Retirada') return 4;
          if (order.status === 'Em Preparo' && !order.assigned_driver_id) return 3;
          if (order.status === 'Saiu para Entrega') return 2;
          if (order.status === 'Em Preparo' && order.assigned_driver_id) return 1;
          return 0;
        };
        const priorityA = statusPriority(a);
        const priorityB = statusPriority(b);
        if (priorityA !== priorityB) return priorityB - priorityA;
        return new Date(a.date).getTime() - new Date(b.date).getTime();
      });
  });

  statsPeriod = signal<'day' | 'week' | 'month' | 'custom'>('day');
  customStartDate = signal<string>(new Date().toISOString().split('T')[0]);
  customEndDate = signal<string>(new Date().toISOString().split('T')[0]);

  deliveryStats = computed(() => {
    const driver = this.currentDriver();
    if (!driver) return { count: 0, totalFee: 0 };
    const now = new Date();
    let startDate: Date;
    switch (this.statsPeriod()) {
      case 'week': startDate = new Date(now.setDate(now.getDate() - now.getDay())); break;
      case 'month': startDate = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'custom': startDate = new Date(this.customStartDate() + 'T00:00:00'); break;
      default: startDate = new Date(now.setHours(0, 0, 0, 0)); break;
    }
    let endDate = this.statsPeriod() === 'custom' ? new Date(this.customEndDate() + 'T23:59:59') : new Date();
    const filteredOrders = this.dataService.orders().filter(o => o.assigned_driver_id === driver.id && o.status === 'Entregue' && new Date(o.date) >= startDate && new Date(o.date) <= endDate);
    const totalFee = filteredOrders.reduce((sum, order) => sum + order.delivery_fee, 0);
    return { count: filteredOrders.length, totalFee };
  });

  handleLogin() {
    this.loginError.set(null);
    if (this.loginForm.invalid) return;
    const { name, password } = this.loginForm.value;
    const result = this.dataService.loginDriver(name!, password || undefined);
    if ('error' in result) this.loginError.set(result.error);
  }
  
  async handleRegister() {
    this.registerError.set(null);
    this.registerForm.markAllAsTouched();
    if (this.registerForm.invalid) return;
    const result = await this.dataService.registerDriver(this.registerForm.value as any);
    if ('error' in result) this.registerError.set(result.error);
    else {
      this.activeView.set('pending');
      this.registerForm.reset();
    }
  }

  logout() {
    this.dataService.logoutDriver();
    this.loginForm.reset();
    this.registerForm.reset();
    this.activeView.set('login');
  }

  async acceptOrder(order: Order) {
    const driver = this.currentDriver();
    if (!driver || order.assigned_driver_id) return;
    this.newDeliveryAvailable.set(false);
    await this.dataService.updateOrderStatus(order.id, order.status, { driverId: driver.id, driverName: driver.name, isBroadcast: true });
  }

  async updateOrderStatus(orderId: string, status: OrderStatus) {
    await this.dataService.updateOrderStatus(orderId, status);
  }

  getGoogleMapsLink(order: Order): string {
    const address = `${order.delivery_address}, ${order.neighborhood}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }
}