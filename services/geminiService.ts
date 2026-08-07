
import { GoogleGenAI, Type } from "@google/genai";

function getGenAI() {
  const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || '';
  if (!apiKey) return null;
  try {
    return new GoogleGenAI({ apiKey });
  } catch (error) {
    console.warn("GoogleGenAI client error:", error);
    return null;
  }
}

export async function analyzePDFContent(fileNames: string[]): Promise<{ summary: string; topics: string[] }> {
  const ai = getGenAI();
  if (!ai) {
    return { 
      summary: "امکان تحلیل هوشمند به کلید API نیاز دارد.", 
      topics: ["PDF"] 
    };
  }

  const prompt = `شما یک دستیار تحلیلگر اسناد هستید. کاربر فایل‌های PDF زیر را برای ادغام آپلود کرده است: ${fileNames.join(', ')}. 
  فقط بر اساس نام این فایل‌ها، حدس بزنید این سند نهایی درباره چیست. 
  یک خلاصه بسیار کوتاه (حداکثر دو جمله) و ۳ موضوع اصلی (هشتگ) به زبان فارسی ارائه دهید. 
  پاسخ باید حتما در قالب JSON باشد.`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            topics: { 
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["summary", "topics"]
        }
      }
    });

    const result = JSON.parse(response.text || '{}');
    return result;
  } catch (error) {
    console.error("Gemini Error:", error);
    return { 
      summary: "در حال حاضر امکان تحلیل محتوا وجود ندارد.", 
      topics: ["نامشخص"] 
    };
  }
}
