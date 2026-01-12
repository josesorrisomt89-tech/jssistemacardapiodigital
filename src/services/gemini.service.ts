import { Injectable, signal } from '@angular/core';
import { GoogleGenAI } from '@google/genai';

@Injectable({
  providedIn: 'root'
})
export class GeminiService {
  private ai: GoogleGenAI | null = null;
  error = signal<string | null>(null);

  constructor() {
    try {
      if (!process.env.API_KEY) {
        throw new Error('A variável de ambiente API_KEY não está configurada.');
      }
      this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    } catch (e) {
      console.error('Falha ao inicializar o GoogleGenAI', e);
      this.error.set('Não foi possível inicializar o serviço de IA. Verifique a Chave de API.');
    }
  }

  async generateDescription(productName: string): Promise<string> {
    if (!this.ai) {
      throw new Error('Serviço de IA não está disponível.');
    }

    const prompt = `Crie uma descrição curta, apetitosa e atraente para um produto de açaíteria chamado "${productName}". Use no máximo 30 palavras. Foque nos ingredientes frescos e na experiência de saborear o produto.`;
    
    try {
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
    if (!this.ai) {
      throw new Error('Serviço de IA não está disponível.');
    }

    const prompt = `Foto de estúdio profissional, estilo propaganda de comida, de um delicioso açaí chamado "${productName}". Detalhes: ${productDescription}. Foco no açaí cremoso, frutas frescas e vibrantes, em uma tigela bonita. Fundo limpo e iluminado. Imagem super realista e apetitosa.`;

    try {
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
