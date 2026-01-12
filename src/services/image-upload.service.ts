import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiService } from './supabase.service';

@Injectable({
  providedIn: 'root'
})
export class ImageUploadService {
  private apiService = inject(ApiService);
  private readonly BUCKET_NAME = 'images';

  /**
   * Faz o upload de uma nova imagem, opcionalmente deletando uma antiga.
   * @param file O novo arquivo de imagem para upload.
   * @param pathPrefix O prefixo do caminho para salvar a imagem (ex: 'products/123').
   * @param currentUrl A URL da imagem atual para ser deletada (opcional).
   * @returns A URL pública da nova imagem.
   */
  async uploadImage(file: File, pathPrefix: string, currentUrl?: string | null): Promise<string> {
    if (currentUrl) {
      // Deleta a imagem antiga, mas não bloqueia o processo se falhar.
      this.deleteImage(currentUrl).catch(err => console.error("Failed to delete old image, continuing upload...", err));
    }
    
    const fileExt = file.name.split('.').pop();
    const filePath = `${pathPrefix}/${Date.now()}.${fileExt}`;
    
    await firstValueFrom(this.apiService.uploadFile(this.BUCKET_NAME, filePath, file));
    
    return this.apiService.getPublicUrl(this.BUCKET_NAME, filePath);
  }

  /**
   * Deleta uma imagem do Supabase Storage a partir de sua URL pública.
   * @param url A URL completa da imagem a ser deletada.
   */
  async deleteImage(url: string): Promise<void> {
    if (!url || !url.includes(this.BUCKET_NAME)) {
      console.warn("Attempted to delete an invalid or non-storage URL:", url);
      return;
    }
    try {
      const path = url.split(`/${this.BUCKET_NAME}/`)[1];
      if (path) {
        await firstValueFrom(this.apiService.deleteFile(this.BUCKET_NAME, [path]));
      }
    } catch (error) {
      console.error("Error deleting image from storage:", error);
      // Não relança o erro para não impedir outras operações (ex: exclusão de produto).
    }
  }

  /**
   * Converte uma string base64 em um objeto File.
   * @param base64 A string de dados base64.
   * @param filename O nome do arquivo a ser criado.
   * @returns Um objeto File.
   */
  base64ToFile(base64: string, filename: string): File {
    const arr = base64.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  }
}