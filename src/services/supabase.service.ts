import { Injectable, signal } from '@angular/core';
import { supabaseConfig } from '../supabase-config';

// Define um tipo placeholder para o cliente Supabase para evitar a importação estática.
// A biblioteca real será carregada dinamicamente.
export type SupabaseClient = any;

@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  private _supabase: SupabaseClient | null = null;
  public readonly initializationError = signal<string | null>(null);
  private initPromise: Promise<boolean> | null = null;

  get supabase(): SupabaseClient {
    if (!this._supabase) {
      throw new Error('O cliente Supabase não foi inicializado. Chame o método init() primeiro.');
    }
    return this._supabase;
  }

  constructor() {}

  /**
   * Inicializa o cliente Supabase de forma assíncrona e dinâmica.
   * Isso garante que a biblioteca do Supabase seja carregada apenas quando necessário,
   * após o aplicativo Angular já ter sido inicializado, evitando crashes na inicialização.
   * Utiliza uma "trava" de promessa (initPromise) para evitar múltiplas inicializações.
   * @returns Uma promessa que resolve para `true` em caso de sucesso e `false` em caso de falha.
   */
  init(): Promise<boolean> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
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
        // Importa dinamicamente a função createClient da URL completa do CDN.
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@^2');
        this._supabase = createClient(supabaseUrl, supabaseAnonKey);
        return true;
      } catch (error) {
        const errorMessage = `Erro Crítico: Não foi possível inicializar o cliente Supabase. Detalhes: ${(error as Error).message}`;
        console.error("FALHA AO INICIALIZAR SUPABASE:", error);
        this.initializationError.set(errorMessage);
        return false;
      }
    })();

    return this.initPromise;
  }
}