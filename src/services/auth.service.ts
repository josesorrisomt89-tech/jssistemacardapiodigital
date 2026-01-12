import { Injectable, signal, inject, Injector } from '@angular/core';
import { Router } from '@angular/router';
import { User, ShopSettings } from '../models';
import { DataService } from './data.service';

const USER_STORAGE_KEY = 'acai_digital_user';
const ADMIN_LOGGED_IN_KEY = 'acai_admin_logged_in';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private router: Router = inject(Router);
  private injector = inject(Injector);
  private _dataService: DataService | null = null;

  // Signals são inicializados puros, sem side-effects.
  currentUser = signal<User | null>(null);
  isAdminLoggedIn = signal<boolean>(false);
  private isInitialized = false;

  constructor() {
    // O construtor é 100% puro, sem efeitos colaterais, para garantir a estabilidade da inicialização.
  }

  // Getter privado para injetar o DataService de forma tardia (lazy), quebrando a dependência circular.
  private get dataService(): DataService {
    if (!this._dataService) {
      this._dataService = this.injector.get(DataService);
    }
    return this._dataService;
  }

  public init(): void {
    if (this.isInitialized) {
      return;
    }
    this.isInitialized = true;
    // O estado é carregado do storage de forma segura aqui, quando o app já está rodando.
    this.currentUser.set(this.loadUserFromStorage());
    this.isAdminLoggedIn.set(this.loadAdminStateFromStorage());
  }

  private loadUserFromStorage(): User | null {
    try {
      const userJson = localStorage.getItem(USER_STORAGE_KEY);
      return userJson ? JSON.parse(userJson) : null;
    } catch (e) {
      console.error('Error loading user from localStorage', e);
      return null;
    }
  }

  private saveUserToStorage(user: User | null) {
    try {
      if (user) {
        localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
      } else {
        localStorage.removeItem(USER_STORAGE_KEY);
      }
    } catch (e) {
      console.error('Error saving user to localStorage', e);
    }
  }

  private loadAdminStateFromStorage(): boolean {
    try {
      const stored = sessionStorage.getItem(ADMIN_LOGGED_IN_KEY);
      return stored === 'true';
    } catch (e) {
      console.error('Error loading admin state from sessionStorage', e);
      return false;
    }
  }

  private saveAdminStateToStorage(isLoggedIn: boolean) {
    try {
      if (isLoggedIn) {
        sessionStorage.setItem(ADMIN_LOGGED_IN_KEY, 'true');
      } else {
        sessionStorage.removeItem(ADMIN_LOGGED_IN_KEY);
      }
    } catch (e) {
      console.error('Error saving admin state to sessionStorage', e);
    }
  }


  // Login para Clientes (agora 100% local, sem Supabase)
  loginWithGoogle(): void {
    // Se já existe um usuário no storage, usa ele. Senão, cria um novo.
    let user = this.loadUserFromStorage();
    if (!user) {
        user = {
          name: 'Cliente Teste',
          email: 'cliente@teste.com',
          photo_url: 'https://picsum.photos/id/237/100/100',
          loyalty_points: 0
        };
    }
    
    this.currentUser.set(user);
    this.saveUserToStorage(user);
    this.router.navigate(['/menu']);
  }

  // Logout para Clientes
  logout(): void {
    this.currentUser.set(null);
    this.saveUserToStorage(null);
    this.router.navigate(['/']);
  }

  // Login para Administradores
  adminLogin(username: string, password: string): { error: string | null } {
    const settings = this.dataService.settings();
    // Use default credentials if not set in settings, for initial setup.
    const adminUser = settings.admin_username || 'admin';
    const adminPass = settings.admin_password || 'admin';

    if (username.trim().toLowerCase() === adminUser.toLowerCase() && password === adminPass) {
      this.isAdminLoggedIn.set(true);
      this.saveAdminStateToStorage(true);
      return { error: null };
    }
    
    return { error: 'Usuário ou senha inválidos.' };
  }
  
  // Logout para Administradores
  adminLogout(): void {
    this.isAdminLoggedIn.set(false);
    this.saveAdminStateToStorage(false);
    this.router.navigate(['/']);
  }

  // Métodos de Fidelidade (atualizam o localStorage)
  addLoyaltyPoints(orderSubtotal: number, settings: ShopSettings): void {
    const user = this.currentUser();
    const loyaltySettings = settings.loyalty_program;
    if (!user || !loyaltySettings?.enabled || loyaltySettings.points_per_real <= 0) return;

    const pointsToAdd = Math.floor(orderSubtotal * loyaltySettings.points_per_real);
    if (pointsToAdd > 0) {
      const newPoints = user.loyalty_points + pointsToAdd;
      const updatedUser = { ...user, loyalty_points: newPoints };
      this.currentUser.set(updatedUser);
      this.saveUserToStorage(updatedUser);
    }
  }

  redeemLoyaltyPoints(settings: ShopSettings): void {
    const user = this.currentUser();
    const loyaltySettings = settings.loyalty_program;
    if (!user || !loyaltySettings?.enabled || user.loyalty_points < loyaltySettings.points_for_reward) return;
    
    const newPoints = user.loyalty_points - loyaltySettings.points_for_reward;
    const updatedUser = { ...user, loyalty_points: newPoints };
    this.currentUser.set(updatedUser);
    this.saveUserToStorage(updatedUser);
  }
}