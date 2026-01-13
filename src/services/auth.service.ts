import { Injectable, signal, inject, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { User, ShopSettings } from '../models';

const USER_STORAGE_KEY = 'acai_digital_user';
const ADMIN_LOGGED_IN_KEY = 'acai_admin_logged_in';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private router: Router = inject(Router);
  
  // A injeção do PLATFORM_ID nos permite verificar se o código está rodando em um navegador.
  @Inject(PLATFORM_ID) private platformId: Object;

  currentUser = signal<User | null>(null);
  isAdminLoggedIn = signal<boolean>(false);
  private isInitialized = false;

  constructor() {}

  public init(): void {
    if (this.isInitialized) {
      return;
    }
    this.isInitialized = true;
    this.currentUser.set(this.loadUserFromStorage());
    this.isAdminLoggedIn.set(this.loadAdminStateFromStorage());
  }

  // Verifica se está no navegador antes de tentar acessar o localStorage.
  private isBrowser(): boolean {
    return isPlatformBrowser(this.platformId);
  }

  private loadUserFromStorage(): User | null {
    if (!this.isBrowser()) return null;
    try {
      const userJson = localStorage.getItem(USER_STORAGE_KEY);
      return userJson ? JSON.parse(userJson) : null;
    } catch (e) {
      console.error('Error loading user from localStorage', e);
      return null;
    }
  }

  private saveUserToStorage(user: User | null) {
    if (!this.isBrowser()) return;
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
    if (!this.isBrowser()) return false;
    try {
      const stored = sessionStorage.getItem(ADMIN_LOGGED_IN_KEY);
      return stored === 'true';
    } catch (e) {
      console.error('Error loading admin state from sessionStorage', e);
      return false;
    }
  }

  private saveAdminStateToStorage(isLoggedIn: boolean) {
    if (!this.isBrowser()) return;
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
  adminLogin(username: string, password: string, settings: ShopSettings): { error: string | null } {
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