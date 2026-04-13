import Groq from 'groq-sdk';

let client: Groq | null = null;

export function getGroqClient(): Groq {
  if (client) return client;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('Missing GROQ_API_KEY');
  client = new Groq({ apiKey });
  return client;
}

export const GROQ_MODEL = 'llama-3.1-8b-instant';
