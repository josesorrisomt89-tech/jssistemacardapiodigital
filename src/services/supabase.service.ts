import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from '../supabase-config';

@Injectable({
  providedIn: 'root',
})
export class SupabaseService {
  public readonly supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = supabaseConfig.url;
    const supabaseAnonKey = supabaseConfig.anonKey;
    
    try {
      if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes('COLOQUE_A_URL') || supabaseAnonKey.includes('COLOQUE_A_CHAVE')) {
        const errorMessage = 'Erro Crítico: A configuração do Supabase (URL/Chave) não foi encontrada ou é inválida. Verifique o arquivo `src/supabase-config.ts`.';
        document.body.innerHTML = `<div style="font-family: sans-serif; color: #e53e3e; background-color: #1a202c; padding: 2rem; height: 100vh;">${errorMessage}</div>`;
        throw new Error(errorMessage);
      }
      
      if (!supabaseAnonKey.startsWith('eyJ')) {
        const errorMessage = `Erro Crítico: A Chave Anônima (anonKey) do Supabase parece estar incorreta. Uma chave válida geralmente começa com "eyJ". A chave fornecida foi: "${supabaseAnonKey}". Por favor, verifique o arquivo 'src/supabase-config.ts' e cole a chave correta da seção API nas configurações do seu projeto Supabase.`;
        document.body.innerHTML = `<div style="font-family: sans-serif; color: #fbd38d; background-color: #1a202c; padding: 2rem; height: 100vh;">${errorMessage}</div>`;
        throw new Error(errorMessage);
      }
      
      this.supabase = createClient(supabaseUrl, supabaseAnonKey);
    } catch (error) {
        const errorMessage = `Erro Crítico: Não foi possível conectar ao Supabase. Verifique se a URL e a Chave estão corretas e se o seu projeto Supabase está ativo. Detalhes: ${(error as Error).message}`;
        console.error("FALHA AO INICIALIZAR SUPABASE:", error);
        document.body.innerHTML = `<div style="font-family: sans-serif; color: #e53e3e; background-color: #1a202c; padding: 2rem; height: 100vh;">${errorMessage}</div>`;
        throw error;
    }
  }
}