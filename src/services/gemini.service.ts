import { Injectable, signal } from '@angular/core';

// Local type definitions to avoid direct module dependency at build/startup time.
// This is a key part of the fix to prevent the app from crashing on start.
interface GenerateContentResponse {
  text: string;
}
interface GenerateImagesResponse {
  generatedImages: { image: { imageBytes: string } }[];
}
interface GenAIModels {
  generateContent(params: { model: string; contents: string; }): Promise<GenerateContentResponse>;
  generateImages(params: { model: string; prompt: string; config: any; }): Promise<GenerateImagesResponse>;
}
interface GoogleGenAI {
  models: GenAIModels;
}

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private ai: GoogleGenAI | null = null;
  private initPromise: Promise<void> | null = null;
  error = signal<string | null>(null);

  constructor() {}

  private initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        if (typeof process === 'undefined' || typeof process.env === 'undefined' || !process.env.API_KEY) {
          throw new Error('Chave de API do Gemini não configurada.');
        }
        
        // Dynamically import the module using its full CDN URL.
        // This completely bypasses the importmap and ensures the module is only loaded when needed.
        const genaiModule: any = await import('https://esm.sh/@google/genai@^1.34.0?external=rxjs');
        const GoogleGenAI_Class = genaiModule.GoogleGenAI;
        this.ai = new GoogleGenAI_Class({ apiKey: process.env.API_KEY });

      } catch (e) {
        const msg = `Não foi possível inicializar o serviço de IA: ${(e as Error).message}`;
        console.error(msg, e);
        this.error.set(msg);
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