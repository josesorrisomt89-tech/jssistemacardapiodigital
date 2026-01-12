import { Injectable, signal } from '@angular/core';
// Use a type-only import to prevent the module from being loaded on startup.
// This is a key change to fix potential startup crashes from external modules.
import type { GoogleGenAI } from '@google/genai';

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private ai: GoogleGenAI | null = null;
  // Use a promise to handle the async initialization and prevent multiple initializations
  private initPromise: Promise<void> | null = null;
  error = signal<string | null>(null);

  constructor() {}

  private initialize(): Promise<void> {
    // If initialization is already in progress or done, return the existing promise
    if (this.initPromise) {
      return this.initPromise;
    }

    // Start the initialization process
    this.initPromise = (async () => {
      try {
        if (typeof process === 'undefined' || typeof process.env === 'undefined' || !process.env.API_KEY) {
          throw new Error('Chave de API do Gemini não configurada.');
        }
        
        // Dynamically import the module only when it's first needed.
        // This prevents it from blocking the initial app load.
        const { GoogleGenAI } = await import('@google/genai');
        this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      } catch (e) {
        const msg = `Não foi possível inicializar o serviço de IA: ${(e as Error).message}`;
        console.error(msg, e);
        this.error.set(msg);
        // Rethrow to notify the caller that initialization failed
        throw e;
      }
    })();
    
    return this.initPromise;
  }

  async generateDescription(productName: string): Promise<string> {
    try {
      await this.initialize();
      if (!this.ai) {
        throw new Error('Cliente de IA não foi inicializado corretamente.');
      }

      const prompt = `Crie uma descrição curta, apetitosa e atraente para um produto de açaíteria chamado "${productName}". Use no máximo 30 palavras. Foque nos ingredientes frescos e na experiência de saborear o produto.`;
      
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
      });

      return response.text.trim();
    } catch (error) {
      console.error('Erro ao gerar descrição:', error);
      throw new Error(`Erro ao gerar descrição: ${(error as Error).message}`);
    }
  }
  
  async generateImage(productName: string, productDescription: string): Promise<string> {
    try {
      await this.initialize();
       if (!this.ai) {
        throw new Error('Cliente de IA não foi inicializado corretamente.');
      }

      const prompt = `Foto de estúdio profissional, estilo propaganda de comida, de um delicioso açaí chamado "${productName}". Detalhes: ${productDescription}. Foco no açaí cremoso, frutas frescas e vibrantes, em uma tigela bonita. Fundo limpo e iluminado. Imagem super realista e apetitosa.`;

       const response = await this.ai.models.generateImages({
          model: 'imagen-4.0-generate-001',
          prompt: prompt,
          config: {
            numberOfImages: 1,
            outputMimeType: 'image/jpeg',
            aspectRatio: '1:1',
          },
      });
      
      const base64ImageBytes = response.generatedImages[0].image.imageBytes;
      return `data:image/jpeg;base64,${base64ImageBytes}`;

    } catch (error) {
      console.error('Erro ao gerar imagem:', error);
       throw new Error(`Erro ao gerar imagem: ${(error as Error).message}`);
    }
  }
}