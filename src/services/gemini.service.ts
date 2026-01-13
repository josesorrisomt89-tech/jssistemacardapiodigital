import { Injectable, signal } from '@angular/core';

// Local type definitions to avoid direct module dependency at build/startup time.
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
  isAvailable = signal<boolean>(false);
  error = signal<string | null>(null);

  constructor() {}

  private initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        if (typeof process === 'undefined' || typeof process.env === 'undefined' || !process.env.API_KEY) {
          // This will no longer throw an error that breaks the build.
          // It will just mean the AI features are not available.
          console.warn('Chave de API do Gemini não configurada. Funcionalidades de IA estarão desabilitadas.');
          this.isAvailable.set(false);
          return;
        }
        
        // @ts-ignore
        const genaiModule: any = await import('@google/genai');
        const GoogleGenAI_Class = genaiModule.GoogleGenAI;
        this.ai = new GoogleGenAI_Class({ apiKey: process.env.API_KEY });
        this.isAvailable.set(true);

      } catch (e) {
        const msg = `Não foi possível inicializar o serviço de IA: ${(e as Error).message}`;
        console.error(msg, e);
        this.error.set(msg);
        this.isAvailable.set(false);
        // We do not re-throw the error here to prevent the build from failing.
      }
    })();
    
    return this.initPromise;
  }

  async generateDescription(productName: string): Promise<string> {
    await this.initialize();
    if (!this.ai || !this.isAvailable()) {
      console.warn('Serviço de IA não disponível. Retornando descrição padrão.');
      return 'Uma deliciosa opção do nosso cardápio, feita com os melhores ingredientes.';
    }

    try {
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
    await this.initialize();
    if (!this.ai || !this.isAvailable()) {
      console.warn('Serviço de IA não disponível. Não é possível gerar imagem.');
      throw new Error('Serviço de IA não disponível.');
    }
    
    try {
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