import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { supabaseConfig } from '../supabase-config';

/**
 * NOTA DE ARQUITETURA: Este serviço substitui o cliente Supabase-JS.
 * Ele usa o HttpClient nativo do Angular para se comunicar diretamente com a API REST do Supabase.
 * Isso resolve um erro fatal de inicialização causado por incompatibilidades da biblioteca externa.
 */
@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private http = inject(HttpClient);
  private apiUrl = supabaseConfig.url;
  private apiKey = supabaseConfig.anonKey;

  private getHeaders(prefer?: string): HttpHeaders {
    let headers = new HttpHeaders({
      'apikey': this.apiKey,
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    });
    if (prefer) {
      headers = headers.set('Prefer', prefer);
    }
    return headers;
  }

  get<T>(tableName: string, params: string = ''): Observable<T[]> {
    const url = `${this.apiUrl}/rest/v1/${tableName}?${params}`;
    return this.http.get<T[]>(url, { headers: this.getHeaders() });
  }

  post<T>(tableName: string, body: any, prefer?: string): Observable<T[]> {
    const url = `${this.apiUrl}/rest/v1/${tableName}`;
    // A API REST do Supabase retorna a representação do objeto dentro de um array
    return this.http.post<T[]>(url, body, { headers: this.getHeaders(prefer) });
  }
  
  patch<T>(tableName: string, query: string, body: any): Observable<T[]> {
    const url = `${this.apiUrl}/rest/v1/${tableName}?${query}`;
    return this.http.patch<T[]>(url, body, { headers: this.getHeaders('return=representation') });
  }

  delete(tableName: string, query: string): Observable<void> {
    const url = `${this.apiUrl}/rest/v1/${tableName}?${query}`;
    return this.http.delete<void>(url, { headers: this.getHeaders() });
  }
  
  upsert<T>(tableName: string, body: any): Observable<T[]> {
      return this.post<T>(tableName, body, 'resolution=merge-duplicates');
  }
}