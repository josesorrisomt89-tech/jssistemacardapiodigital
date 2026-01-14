import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { supabaseConfig } from '../supabase-config';

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
    return this.http.get<T[]>(url, { headers: this.getHeaders().set('Content-Type', 'application/json') });
  }

  post<T>(tableName: string, body: any, prefer?: string): Observable<T[]> {
    const url = `${this.apiUrl}/rest/v1/${tableName}`;
    // O chamador é responsável por formatar o corpo da requisição. Para inserções e upserts em tabelas,
    // a API do Supabase geralmente espera um array de objetos, ex: `[{...}]`.
    return this.http.post<T[]>(url, body, { headers: this.getHeaders(prefer).set('Content-Type', 'application/json') });
  }
  
  patch<T>(tableName: string, query: string, body: any): Observable<T[]> {
    const url = `${this.apiUrl}/rest/v1/${tableName}?${query}`;
    return this.http.patch<T[]>(url, body, { headers: this.getHeaders('return=representation').set('Content-Type', 'application/json') });
  }

  delete(tableName: string, query: string): Observable<void> {
    const url = `${this.apiUrl}/rest/v1/${tableName}?${query}`;
    return this.http.delete<void>(url, { headers: this.getHeaders().set('Content-Type', 'application/json') });
  }
  
  upsert<T>(tableName: string, body: any): Observable<T[]> {
      // A API do Supabase espera um array de objetos para upsert, mesmo para um único registro.
      const payload = Array.isArray(body) ? body : [body];
      return this.post<T>(tableName, payload, 'resolution=merge-duplicates,return=representation');
  }

  // Storage Methods
  uploadFile(bucket: string, path: string, file: File): Observable<{ Key: string }> {
    const url = `${this.apiUrl}/storage/v1/object/${bucket}/${path}`;
    const headers = this.getHeaders()
                      .set('Content-Type', file.type)
                      .set('x-upsert', 'true');
    return this.http.post<{ Key: string }>(url, file, { headers });
  }
  
  deleteFile(bucket: string, paths: string[]): Observable<any> {
    const url = `${this.apiUrl}/storage/v1/object/${bucket}`;
    const headers = this.getHeaders().set('Content-Type', 'application/json');
    return this.http.delete(url, { headers, body: { prefixes: paths } });
  }

  getPublicUrl(bucket: string, path: string): string {
    return `${this.apiUrl}/storage/v1/object/public/${bucket}/${path}`;
  }
}