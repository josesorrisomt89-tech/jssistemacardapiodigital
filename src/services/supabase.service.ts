import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from '../supabase-config';

@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  private _supabase: SupabaseClient | null = null;
  public readonly initializationError = signal<string | null>(null);
  private initialized = false;

  get supabase(): SupabaseClient {
    if (!this._supabase) {
      throw new Error('O cliente Supabase não foi inicializado. Chame o método init() primeiro.');
    }
    return this._supabase;
  }

  constructor() {
    // O construtor agora é vazio para evitar falhas durante a injeção de dependência.
  }

  init(): boolean {
    if (this.initialized) {
      return !this.initializationError();
    }
    this.initialized = true;

    const supabaseUrl = supabaseConfig.url;
    const supabaseAnonKey = supabaseConfig.anonKey;

    if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('COLOQUE_A_URL') || supabaseAnonKey.includes('COLOQUE_A_CHAVE')) {
      const errorMessage = 'Erro Crítico: A configuração do Supabase (URL/Chave) não foi encontrada ou é inválida. Verifique o arquivo `src/supabase-config.ts`.';
      this.initializationError.set(errorMessage);
      console.error(errorMessage);
      return false;
    }

    if (!supabaseAnonKey.startsWith('eyJ')) {
      const errorMessage = `Erro Crítico: A Chave Anônima (anonKey) do Supabase parece estar incorreta. Uma chave válida geralmente começa com "eyJ". Por favor, verifique o arquivo 'src/supabase-config.ts'.`;
      this.initializationError.set(errorMessage);
      console.error(errorMessage);
      return false;
    }

    try {
      this._supabase = createClient(supabaseUrl, supabaseAnonKey);
      return true;
    } catch (error) {
      const errorMessage = `Erro Crítico: Não foi possível inicializar o cliente Supabase. Detalhes: ${(error as Error).message}`;
      console.error("FALHA AO INICIALIZAR SUPABASE:", error);
      this.initializationError.set(errorMessage);
      return false;
    }
  }
}