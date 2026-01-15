import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { supabaseConfig } from '../supabase-config';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private http = inject(HttpClient);
  private apiUrl = supabaseConfig.url;
  private apiKey = supabaseConfig.anonKey;

  private handleError(error: any): Observable<never> {
    console.error('API Error:', error.message || error);
    const errorMessage = error?.error?.message || error?.message || 'Ocorreu um erro desconhecido na comunicação com o servidor.';
    
    let friendlyMessage = `Erro na API: ${errorMessage}`;
    if (typeof errorMessage === 'string') {
      if (errorMessage.includes('security policy') || errorMessage.includes('violates row-level security')) {
        friendlyMessage = 'Falha de permissão. Verifique as políticas de segurança (RLS) da tabela no Supabase.';
      } else if (errorMessage.includes('Invalid API key')) {
        friendlyMessage = 'Não autorizado. Verifique a chave da API (anonKey) no Supabase.';
      }
    }
    
    if (error.status === 404) {
      friendlyMessage = 'Não encontrado. O endpoint da API ou o registro não existe.';
    } else if (error.status === 401) {
      friendlyMessage = 'Não autorizado. Verifique a chave da API do Supabase.';
    } else if (error.status === 400) {
      friendlyMessage = `Requisição inválida: ${errorMessage}`;
    } else if (error.status === 0 || (error.name === 'HttpErrorResponse' && error.status === 0)) {
      friendlyMessage = 'Erro de conexão. Verifique sua internet ou a configuração de CORS no painel do Supabase.';
    }
    
    return throwError(() => new Error(friendlyMessage));
  }

  private getHeaders(prefer?: string): HttpHeaders {
    let headers = new HttpHeaders({
      'apikey': this.apiKey,
      'Authorization': `Bearer ${this.apiKey}`
    });
    if (prefer) {
      headers = headers.set('Prefer', prefer);
    }
    return headers;
  }

  // Database Methods
  get<T>(tableName: string, params: string = ''): Observable<T[]> {
    const url = `${this.apiUrl}/rest/v1/${tableName}?${params}`;
    return this.http.get<T[]>(url, { headers: this.getHeaders().set('Content-Type', 'application/json') }).pipe(catchError(this.handleError));
  }

  post<T>(tableName: string, body: any, prefer?: string): Observable<T[]> {
    const url = `${this.apiUrl}/rest/v1/${tableName}`;
    return this.http.post<T[]>(url, body, { headers: this.getHeaders(prefer).set('Content-Type', 'application/json') }).pipe(catchError(this.handleError));
  }
  
  patch<T>(tableName: string, query: string, body: any): Observable<T[]> {
    const url = `${this.apiUrl}/rest/v1/${tableName}?${query}`;
    return this.http.patch<T[]>(url, body, { headers: this.getHeaders('return=representation').set('Content-Type', 'application/json') }).pipe(catchError(this.handleError));
  }

  delete(tableName: string, query: string): Observable<void> {
    const url = `${this.apiUrl}/rest/v1/${tableName}?${query}`;
    return this.http.delete<void>(url, { headers: this.getHeaders().set('Content-Type', 'application/json') }).pipe(catchError(this.handleError));
  }
  
  upsert<T>(tableName: string, body: any): Observable<T[]> {
      const payload = Array.isArray(body) ? body : [body];
      return this.post<T>(tableName, payload, 'resolution=merge-duplicates,return=representation');
  }

  // Storage Methods
  uploadFile(bucket: string, path: string, file: File): Observable<{ Key: string }> {
    const url = `${this.apiUrl}/storage/v1/object/${bucket}/${path}`;
    const headers = this.getHeaders()
                      .set('Content-Type', file.type)
                      .set('x-upsert', 'true');
    return this.http.post<{ Key: string }>(url, file, { headers }).pipe(catchError(this.handleError));
  }
  
  deleteFile(bucket: string, paths: string[]): Observable<any> {
    const url = `${this.apiUrl}/storage/v1/object/${bucket}`;
    const headers = this.getHeaders().set('Content-Type', 'application/json');
    return this.http.delete(url, { headers, body: { prefixes: paths } }).pipe(catchError(this.handleError));
  }

  getPublicUrl(bucket: string, path: string): string {
    return `${this.apiUrl}/storage/v1/object/public/${bucket}/${path}`;
  }
}