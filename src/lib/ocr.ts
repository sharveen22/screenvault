import { createWorker } from 'tesseract.js';

export async function extractTextFromImage(imageFile: File): Promise<{
  text: string;
  confidence: number;
}> {
  const worker = await createWorker('eng');

  try {
    const { data } = await worker.recognize(imageFile);
    return {
      text: data.text.trim(),
      confidence: data.confidence / 100,
    };
  } finally {
    await worker.terminate();
  }
}

export function generateSmartFilename(ocrText: string, originalFilename: string): string {
  if (!ocrText || ocrText.length < 10) {
    return originalFilename;
  }

  const cleanText = ocrText
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleanText.split(' ')
    .filter(word => word.length > 3)
    .slice(0, 5);

  if (words.length === 0) {
    return originalFilename;
  }

  const smartName = words.join('_').toLowerCase();
  const timestamp = new Date().toISOString().split('T')[0];
  const extension = originalFilename.split('.').pop();

  return `${smartName}_${timestamp}.${extension}`;
}

export function generateTags(ocrText: string): string[] {
  if (!ocrText || ocrText.length < 10) {
    return [];
  }

  const commonWords = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their'
  ]);

  const words = ocrText
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3 && !commonWords.has(word));

  const wordFrequency = new Map<string, number>();
  words.forEach(word => {
    wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
  });

  const sortedWords = Array.from(wordFrequency.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);

  const detectedTypes = [];
  const lowerText = ocrText.toLowerCase();

  if (lowerText.includes('error') || lowerText.includes('exception') || lowerText.includes('failed')) {
    detectedTypes.push('error');
  }
  if (lowerText.includes('function') || lowerText.includes('const') || lowerText.includes('class') || lowerText.includes('import')) {
    detectedTypes.push('code');
  }
  if (lowerText.includes('design') || lowerText.includes('color') || lowerText.includes('font')) {
    detectedTypes.push('design');
  }
  if (lowerText.includes('http') || lowerText.includes('www') || lowerText.includes('.com')) {
    detectedTypes.push('web');
  }
  if (lowerText.includes('email') || lowerText.includes('@')) {
    detectedTypes.push('email');
  }

  return [...new Set([...detectedTypes, ...sortedWords])];
}
