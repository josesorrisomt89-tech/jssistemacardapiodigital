import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from '../supabase-config';

@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  public readonly supabase: SupabaseClient;
  public readonly initializationError = signal<string | null>(null);

  constructor() {
    const supabaseUrl = supabaseConfig.url;
    const supabaseAnonKey = supabaseConfig.anonKey;

    if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('COLOQUE_A_URL') || supabaseAnonKey.includes('COLOQUE_A_CHAVE')) {
      const errorMessage = 'Erro Crítico: A configuração do Supabase (URL/Chave) não foi encontrada ou é inválida. Verifique o arquivo `src/supabase-config.ts`.';
      this.initializationError.set(errorMessage);
      console.error(errorMessage);
      // Fornece um cliente dummy para evitar quebras no código que depende deste serviço.
      this.supabase = {} as SupabaseClient;
      return;
    }

    if (!supabaseAnonKey.startsWith('eyJ')) {
      const errorMessage = `Erro Crítico: A Chave Anônima (anonKey) do Supabase parece estar incorreta. Uma chave válida geralmente começa com "eyJ". Por favor, verifique o arquivo 'src/supabase-config.ts'.`;
      this.initializationError.set(errorMessage);
      console.error(errorMessage);
      this.supabase = {} as SupabaseClient;
      return;
    }

    try {
      this.supabase = createClient(supabaseUrl, supabaseAnonKey);
    } catch (error) {
      const errorMessage = `Erro Crítico: Não foi possível inicializar o cliente Supabase. Detalhes: ${(error as Error).message}`;
      console.error("FALHA AO INICIALIZAR SUPABASE:", error);
      this.initializationError.set(errorMessage);
      this.supabase = {} as SupabaseClient;
    }
  }
}